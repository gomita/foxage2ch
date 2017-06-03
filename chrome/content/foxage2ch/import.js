////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://foxage2ch/utils.jsm");


////////////////////////////////////////////////////////////////////////////////
// ImportWizard

var ImportWizard = {

	_wizard: null,

	_bundle: null,

	init: function() {
		this._wizard = document.documentElement;
		this._bundle = document.getElementById("importBundle");
	},

	uninit: function() {
		this._wizard = null;
		this._bundle = null;
	},

	onSelectAppPage: function() {
		if (this._wizard)
			this._wizard.canAdvance = true;
	},

	onSelectFilePage: function() {
		document.getElementById("browseButton").focus();
		var fileSelected = document.getElementById("importFile").file;
		this._wizard.canAdvance = fileSelected;
	},

	selectFile: function(aButton) {
		var filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		filePicker.init(window, aButton.getAttribute("filepickerlabel"), filePicker.modeOpen);
		filePicker.appendFilter("RDF", "*.rdf");
		var dir = ImportProcessor.getLegacyDataDir();
		if (dir)
			filePicker.displayDirectory = dir;
		if (filePicker.show() == filePicker.returnOK) {
			document.getElementById("importFile").file = filePicker.file;
			document.getElementById("importFile").label = filePicker.file.path;
			this._wizard.canAdvance = true;
		}
	},

	onProcessingPage: function() {
		this._wizard.canRewind = false;
		this._wizard.canAdvance = false;
		this._wizard.getButton("cancel").disabled = true;	// cannot cancel
		var listbox = document.getElementById("importingListbox");
		while (listbox.getItemAtIndex(0))
			listbox.removeItemAt(0);
		var inputFile = document.getElementById("importFile").file;
		var outputFile = FoxAge2chUtils.dataDir;
		outputFile.append("foxage2ch.json");
		ImportProcessor.run(inputFile, outputFile, this);
	},

	onDonePage: function() {
		this._wizard.canRewind = false;
	},

	////////////////////////////////////////////////////////////////////////////////
	// インポート処理のコールバック

	onImportProgress: function(aItemTitle) {
		var msg = this._bundle.getString("IMPORT_PROGRESS") + aItemTitle;
		var listbox = document.getElementById("importingListbox");
		var listitem = listbox.appendItem(msg);
		listbox.ensureElementIsVisible(listitem);
	},

	onImportDone: function(aItemsCount) {
		this._wizard.canAdvance = true;
		this._wizard.advance();
		var msg = this._bundle.getFormattedString("IMPORT_DONE", [aItemsCount]);
		document.getElementById("doneMessage").textContent = msg;
		FoxAge2chUtils.service.reloadData();
	},

	onImportFailed: function(aErrorMessage) {
		alert(this._bundle.getString("IMPORT_FAILED") + "\n\n" + aErrorMessage);
		this._wizard.canRewind = true;
		this._wizard.getButton("cancel").disabled = false;
	}

};


////////////////////////////////////////////////////////////////////////////////
// Import Processor

var ImportProcessor = {

	get rdfSvc() {
		delete this.rdfSvc;
		return this.rdfSvc = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
	},

	get rdfContainer() {
		delete this.rdfContainer;
		return this.rdfContainer = Cc["@mozilla.org/rdf/container;1"].getService(Ci.nsIRDFContainer);
	},

	_dataSource: null,
	_result: null,
	_observer: {
		onImportProgress: function(aItemTitle) {},
		onImportDone    : function(aItemsCount) {},
		onImportFailed  : function(aErrorMessage) {},
	},

	run: function(aInputFile, aOutputFile, aObserver) {
		try {
			this._observer = aObserver;
			this._result = [];
			// 読み込み～処理
			var ioSvc = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
			var fileURL = ioSvc.newFileURI(aInputFile).spec;
			this._dataSource = this.rdfSvc.GetDataSourceBlocking(fileURL);
			this._observer.onImportProgress("Input File: " + aInputFile.path);
			this._observer.onImportProgress("Output File: " + aOutputFile.path);
			this._result.push({ id: "root" });
			this._processRDFResource(this.rdfSvc.GetResource("urn:foxage2ch:root"));
			// JSON文字列書き込み
			// [TODO] この処理はxdIFoxAge2chService側へ移動すべき
			var JSONParser = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
			var result = JSONParser.encode(this._result);
			this._observer.onImportProgress(result);
			var uniConv = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
			              getService(Ci.nsIScriptableUnicodeConverter);
			uniConv.charset = "UTF-8";
			result = uniConv.ConvertFromUnicode(result);
			var stream = Cc["@mozilla.org/network/safe-file-output-stream;1"].
			             createInstance(Ci.nsIFileOutputStream);
			stream.init(aOutputFile, 0x02 | 0x08 | 0x20, 0644, 0);
			stream.write(result, result.length);
			stream.QueryInterface(Ci.nsISafeOutputStream);
			stream.finish();
			// RDFデータソース破棄
			this.rdfSvc.UnregisterDataSource(this._dataSource);
			this._observer.onImportDone(this._result.length);
		}
		catch(ex) {
			this._observer.onImportFailed(ex);
		}
	},

	getLegacyDataDir: function() {
		const DIR_NAME = "foxage";
		const PREF_DIR_DEFAULT = "foxage2ch.dir.default";
		const PREF_DIR_PATH = "foxage2ch.dir.path";
		var dir = null;
		var prefBranch = Cc["@mozilla.org/preferences;1"].getService(Ci.nsIPrefBranch);
		var useDefault = true;
		try {
			useDefault = prefBranch.getBoolPref(PREF_DIR_DEFAULT);
		}
		catch (ex) {}
		if (useDefault) {
			var dirSvc = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
			dir = dirSvc.get("ProfD", Ci.nsIFile);
			dir.append(DIR_NAME);
		}
		else {
			var path = "";
			try {
				path = prefBranch.getComplexValue(PREF_DIR_PATH, Ci.nsIPrefLocalizedString).data;
			}
			catch (ex) {}
			dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
			dir.initWithPath(path);
		}
		return dir.exists() ? dir : null;
	},

	_getProperty: function(aRes, aProp) {
		const NAME_SPACE = "http://amb.vis.ne.jp/mozilla/foxage2ch-rdf#";
		try {
			aProp = this.rdfSvc.GetResource(NAME_SPACE + aProp);
			var retVal = this._dataSource.GetTarget(aRes, aProp, true);
			return retVal.QueryInterface(Ci.nsIRDFLiteral).Value;
		}
		catch(ex) {
			return "";
		}
	},

	_processRDFResource: function(aContainerRes) {
		this.rdfContainer.Init(this._dataSource, aContainerRes);
		var resEnum = this.rdfContainer.GetElements();
		while (resEnum.hasMoreElements()) {
			var res = resEnum.getNext().QueryInterface(Ci.nsIRDFResource);
			var itemId = res.Value.substr("urn:foxage2ch:".length);
			var type = this._getProperty(res, "type");
			var title = this._getProperty(res, "title");
			var status = this._getProperty(res, "status");
			title = FoxAge2chUtils.sanitizeTitle(FoxAge2chUtils.unescapeEntities(title));
			var flags = 0;
			if (status.indexOf("checking") >= 0)
				flags |= FoxAge2chUtils.STATUS_CHECKING;
			if (status.indexOf("updated") >= 0)
				flags |= FoxAge2chUtils.STATUS_UPDATED;
			if (status.indexOf("datout") >= 0)
				flags |= FoxAge2chUtils.STATUS_DATOUT;
			if (status.indexOf("error") >= 0)
				flags |= FoxAge2chUtils.STATUS_ERROR;
			this._observer.onImportProgress(title);
			var item;
			switch (type) {
				case "board": 
					item = FoxAge2chUtils.createBoardItem(itemId, title);
					item.status = flags;
					if (/ \((\d+)\)$/.test(item.title)) {
						item.title = RegExp.leftContext;
						item.unread = parseInt(RegExp.$1, 10);
					}
					item.checkDate = parseInt(this._getProperty(res, "lastNum"), 10) || 0;
					if (status.indexOf("disabled") >= 0)
						item.skip = true;
					break;
				case "thread": 
					var boardItem = { id: aContainerRes.Value.substr("urn:foxage2ch:".length) };
					item = FoxAge2chUtils.createThreadItem(itemId, boardItem, title);
					item.status = flags;
					item.title = item.title.replace(/^\[\d{1,4}\]\s+/, "");
					item.readRes = parseInt(this._getProperty(res, "readNum"), 10) || 0;
					item.lastRes = parseInt(this._getProperty(res, "lastNum"), 10) || 0;
					break;
				case "separator": 
					item = FoxAge2chUtils.createSeparatorItem(title);
					break;
			}
			this._result.push(item);
			if (item.type == FoxAge2chUtils.TYPE_BOARD)
				// 再帰処理
				this._processRDFResource(res);
		}
	}

};


