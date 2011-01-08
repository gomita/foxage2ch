////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const SCORE_THRESHOLD = 2;
const RDF_NAME_SPACE = "http://www.xuldev.org/foxage2ch-rdf#";

Components.utils.import("resource://foxage2ch/utils.jsm");


////////////////////////////////////////////////////////////////////////////////
// FindThread

var FindThread = {

	get rdfSvc() {
		delete this.rdfSvc;
		return this.rdfSvc = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
	},

	// 元スレのアイテム (次スレ検索モードのみ)
	threadItem: null,

	// 板のアイテム
	boardItem: null,

	// xul:wizard
	wizard: null,

	// HTTPRequestインスタンス
	httpReq: null,

	// subject.txtをパースした{ key: DAT番号, title: スレタイ }の配列
	_allThreads: [],

	// nsIRDFDataSource
	_dataSource: null,

	// 連続次スレ検索で順番待ちスレッドIDの配列
	_queuedThreadIds: null,

	init: function() {
		if (!window.arguments || !window.opener)
			throw Cr.NS_ERROR_INVALID_ARG;
		var item = FoxAge2chUtils.service.getItem(window.arguments[0]);
		if (item.type == FoxAge2chUtils.TYPE_THREAD) {
			// 次スレ検索モード
			this.threadItem = item;
			this.boardItem = FoxAge2chUtils.service.getItem(item.parent);
			// 連続次スレ検索のキューを追加
			if (window.arguments[1])
				this._queuedThreadIds = window.arguments[1];
		}
		else {
			// スレッド検索モード
			this.threadItem = null;
			this.boardItem = item;
			document.getElementById("resultCheckbox").hidden = true;
		}
		if (!this.boardItem)
			throw Cr.NS_ERROR_UNEXPECTED;
		this.wizard = document.getElementById("findThreadWizard");
		this.wizard.canAdvance = false;
		this.wizard.getButton("cancel").focus();
		var msg = FoxAge2chUtils.getLocaleString("CHECKING") + ": " + this.boardItem.title;
		document.getElementById("requestField").value = msg
		document.getElementById("requestMeter").collapsed = false;
		var url = FoxAge2chUtils.parseToURL(this.boardItem) + "subject.txt";
		var loadCallback = function(aResponseText) {
			aResponseText.split("\n").forEach(function(aLine) {
				// 1213352492.dat<>Mozilla Firefox Part85 (39) → %key%.dat<>%title% (nn)
				// 1212650212.cgi,ぷよぷよシリーズ！(72)       → %key%.cgi,%title%(nn)
				if (/^(\d+)\.(?:dat<>|cgi,)(.+)\s*\((\d{1,4})\)$/.test(aLine))
					this.owner._allThreads.push({
						key: RegExp.$1,
						created: parseInt(RegExp.$1, 10) * 1000 * 1000,
						lastRes: parseInt(RegExp.$3, 10),
						title: FoxAge2chUtils.unescapeEntities(FoxAge2chUtils.sanitizeTitle(RegExp.$2))
					});
			}, this);
			this.owner.wizard.canAdvance = true;
			this.owner.wizard.advance();
		};
		var errorCallback = function(aStatus) {
			this.owner.wizard.canAdvance = true;
			this.owner.wizard.advance();
		};
		this.httpReq = FoxAge2chUtils.createHTTPRequest();
		this.httpReq.owner = this;
		this.httpReq.send(url, loadCallback, errorCallback);
	},

	done: function() {
		// 注意: インメモリデータソースをUnregisterDataSourceしようとすると、
		//       Cr.NS_ERROR_UNEXPECTED例外がスローされる。
		this._rdfContainer = null;
		this._dataSource = null;
		this._allThreads = null;
		if (this.httpReq) {
			this.httpReq.destroy();
			this.httpReq = null;
		}
		this.wizard = null;
		this.boardItem = null;
		this.threadItem = null;
		// 連続次スレ検索を続行
		if (this._queuedThreadIds && this._queuedThreadIds.length > 0) {
			window.opener.openDialog(
				"chrome://foxage2ch/content/findThread.xul", "FoxAge2ch:FindThread",
				"chrome,centerscreen,modal,all",
				this._queuedThreadIds.shift(), this._queuedThreadIds
			);
		}
	},

	onResultPage: function() {
		this.wizard.canRewind = false;
		if (this.threadItem) {
			var checkbox = document.getElementById("resultCheckbox");
			checkbox.label = checkbox.getAttribute("orglabel") + this.threadItem.title;
			document.getElementById("searchFilter").value = this.threadItem.title;
		}
		// データソースとコンテナリソースの初期化
		this._dataSource = Cc["@mozilla.org/rdf/datasource;1?name=in-memory-datasource"].
		                   createInstance(Ci.nsIRDFDataSource);
		this._rdfContainer = Cc["@mozilla.org/rdf/container-utils;1"].getService(Ci.nsIRDFContainerUtils).
		                     MakeSeq(this._dataSource, this.rdfSvc.GetResource("urn:root"));
		document.getElementById("resultTree").database.AddDataSource(this._dataSource);
		this.doSearch(document.getElementById("searchFilter").value);
		document.getElementById("searchFilter").select();
	},

	doSearch: function(aSearchFor) {
		// 追加済みのリソースをすべて削除
		while (this._rdfContainer.GetCount() > 0) {
			var res = this._rdfContainer.RemoveElementAt(1, true);
			var arcEnum = this._dataSource.ArcLabelsOut(res);
			while (arcEnum.hasMoreElements()) {
				var arc = arcEnum.getNext().QueryInterface(Ci.nsIRDFResource);
				var target = this._dataSource.GetTarget(res, arc, true);
				this._dataSource.Unassert(res, arc, target);
			}
		}
		if (aSearchFor) {
			this._allThreads.forEach(function(dat) {
				if (this.threadItem && this.threadItem.id.indexOf(dat.key) >= 0)
					// 元スレは表示しない
					return;
				var [match, score] = this._compareTitles(aSearchFor, dat.title);
				if (score < SCORE_THRESHOLD)
					// スコアが閾値以下の場合は表示しない
					return;
				var threadItemId = this.boardItem.id + "/" + dat.key;
				var res = this.rdfSvc.GetResource(threadItemId);
				// 一部の2ch宣伝スレのDATキーがスレ立て日時でないことに注意
				var created = dat.created < 9000000000000000 ? 
				              this.rdfSvc.GetDateLiteral(dat.created) : this.rdfSvc.GetLiteral("");
				this._dataSource.Assert(res, this._makeArcLabel("title"), this.rdfSvc.GetLiteral(dat.title), true);
				this._dataSource.Assert(res, this._makeArcLabel("match"), this.rdfSvc.GetLiteral(match), true);
				this._dataSource.Assert(res, this._makeArcLabel("score"), this.rdfSvc.GetIntLiteral(score), true);
				this._dataSource.Assert(res, this._makeArcLabel("lastRes"), this.rdfSvc.GetIntLiteral(dat.lastRes), true);
				this._dataSource.Assert(res, this._makeArcLabel("created"), created, true);
				if (FoxAge2chUtils.service.getItem(threadItemId))
					// すでに追加済みのスレッド
					this._dataSource.Assert(res, this._makeArcLabel("class"), this.rdfSvc.GetLiteral("added"), true);
				this._rdfContainer.AppendElement(res);
			}, this);
		}
		document.getElementById("resultTree").builder.rebuild();
	},

	onFinish: function() {
		// FoxAge2chをタブで開いている場合、window.openerはXPCNativeWrapperとなる。
		var opener = window.opener.wrappedJSObject || window.opener;
		var tree = document.getElementById("resultTree");
		for (var rc = 0; rc < tree.view.selection.getRangeCount(); rc++) {
			var start = {}, end = {};
			tree.view.selection.getRangeAt(rc, start, end);
			for (var i = start.value; i <= end.value; i++) {
				var res = tree.builderView.getResourceAtIndex(i);
				var itemId = res.Value;
				if (FoxAge2chUtils.service.getItem(itemId))
					// すでに追加済み
					continue;
				var title = this._getPropertyValue(res, "title");
				var item = FoxAge2chUtils.createThreadItem(itemId, this.boardItem, title);
				item.lastRes = parseInt(this._getPropertyValue(res, "lastRes"), 10);
				item.status = FoxAge2chUtils.STATUS_UPDATED;
				FoxAge2chUtils.service.insertItem(item, null);
				// 追加したアイテムをツリー上で選択
				if ("FoxAge2chUI" in opener)
					opener.FoxAge2chUI.onItemAdded(item);
			}
		}
		if (document.getElementById("resultCheckbox").checked)
			// 元スレ削除
			FoxAge2chUtils.service.removeItem(this.threadItem);
	},

	onCancel: function() {
		// 連続次スレ検索のキューをクリア
		if (this._queuedThreadIds)
			this._queuedThreadIds = null;
	},

	onCycleHeader: function(event) {
		if (event.target.localName != "treecol")
			return;
		// 列クリックによるソート時、選択を解除する
		document.getElementById("resultTree").view.selection.clearSelection();
	},

	// 「スレッド Part 9」「スレ part99」などを削除する
	_purifyTitle: function(aTitle) {
		aTitle = aTitle.replace(/(?:スレッド|スレ)\s*PART\s*\d+/i, "");
		return aTitle;
	},

	_compareTitles: function(aOrgTitle, aNewTitle) {
		aOrgTitle = this._purifyTitle(aOrgTitle);
		aNewTitle = this._purifyTitle(aNewTitle);
		var finalMatch = "";
		var finalScore = 0;
		for (var i = 0; i < aOrgTitle.length; i++) {
			var firstChar = aOrgTitle.charAt(i);
			var firstPos = 0;
			while (firstPos != -1) {
				firstPos = aNewTitle.toUpperCase().indexOf(firstChar.toUpperCase(), firstPos);
				if (firstPos < 0)
					continue;
				// dump("*** firstChar = " + firstChar + ", firstPos = " + firstPos + "\n");	// #debug
				var match = "";
				for (var j = i, k = firstPos; j < aOrgTitle.length, k < aNewTitle.length; j++, k++) {
					var orgChar = aOrgTitle.charAt(j);
					var newChar = aNewTitle.charAt(k);
					if (orgChar.toUpperCase() != newChar.toUpperCase())
						break;
					match = match.concat(newChar);
					// dump("[" + j + "] " + orgChar + "\t[" + k + "] " + newChar + "\t\t\t" + match + "\n");	// #debug
				}
				// マルチバイト文字はスコア2に換算する
				var score = match.replace(/[^\x20-\xFF]/g, "##").length;
				if (score > finalScore) {
					finalMatch = match;
					finalScore = score;
				}
				firstPos++;
			}
		}
		return [finalMatch, finalScore];
	},

	_makeArcLabel: function(aProperty) {
		return this.rdfSvc.GetResource(RDF_NAME_SPACE + aProperty);
	},

	_getPropertyValue: function(aResource, aProperty) {
		var target = this._dataSource.GetTarget(aResource, this._makeArcLabel(aProperty), true);
		if (!target)
			return null;
		if (target instanceof Ci.nsIRDFLiteral)
			return target.QueryInterface(Ci.nsIRDFLiteral).Value;
		if (target instanceof Ci.nsIRDFInt)
			return target.QueryInterface(Ci.nsIRDFInt).Value;
		if (target instanceof Ci.nsIRDFDate)
			return target.QueryInterface(Ci.nsIRDFDate).Value;
	}

};


