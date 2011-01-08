// @see PrefsUI#readViewerType
Components.utils.import("resource://foxage2ch/utils.jsm");

var PrefsUI = {

	_element: function(aID) {
		return document.getElementById(aID);
	},

	// radiogroup[preference="pref:tree.viewMode"]@onsyncfrompreference
	readViewMode: function() {
		var viewMode = this._element("pref:tree.viewMode").value;
		this._element("autoCollapseCheckbox").disabled = (viewMode != 0);
	},

	// radiogroup[preference="pref:viewer.type"]@onsyncfrompreference
	readViewerType: function() {
		var viewerType = this._element("pref:viewer.type").value;
		this._element("viewerURL").disabled = (viewerType != 2);
		this._element("viewerTypeBbs2ch").disabled = !FoxAge2chUtils.bbs2chVersion;
	},

	// checkbox[preference="pref:autoCheckInterval"]@onsyncfrompreference
	readAutoCheckInterval: function() {
		var enabled = this._element("pref:autoCheckInterval").value > 0;
		this._element("autoCheck").disabled = !enabled;
		return enabled;
	},

	// textbox[preference="pref:maxConnections"]@onsyncfrompreference
	readMaxConnections: function() {
		var maxConn = this._element("pref:maxConnections").value;
		this._element("maxConnMin").hidden = maxConn > 2;
		this._element("maxConnMax").hidden = maxConn <= 2;
	},

	// checkbox[preference="pref:upwardMargin"]@onsyncfrompreference
	readUpwardMargin: function() {
		var showAll = this._element("pref:upwardMargin").value < 0;
		this._element("upwardMargin").disabled = showAll;
		return showAll;
	},

	// radiogroup[preference="pref:dataDir.default"]@onsyncfrompreference
	readDataDirDefault: function() {
		var useDefault = !!this._element("pref:dataDir.default").value;
		this._element("dataDirField").disabled = useDefault;
		this._element("chooseDirButton").disabled = useDefault;
	},

	// filefield[preference="pref:dataDir.path"]@onsyncfrompreference
	//   filefield要素表示直後の設定値読み込み時
	// preference#pref:dataDir.path@onchange
	//   selectDirでpreference要素へ値を書き込んだとき
	//   about:configからdataDir.pathを直接変更したとき
	displayDataDirPref: function() {
		var file = this._element("pref:dataDir.path").value;
		var field = this._element("dataDirField");
		field.file = file;
		field.label = file ? file.path : "";
	},

	// button#chooseDirButton@oncommand
	chooseFolder: function() {
		var lastDir = this._element("pref:dataDir.path").value;
		var fp = Components.classes["@mozilla.org/filepicker;1"].
		         createInstance(Components.interfaces.nsIFilePicker);
		var label = this._element("chooseDirButton").getAttribute("filepickerlabel");
		fp.init(window, label, fp.modeGetFolder);
		if (lastDir)
			fp.displayDirectory = lastDir;
		if (fp.show() == fp.returnOK) {
			// preference要素へ設定値を書き込み
			// この後preference要素のonchangeイベントが発生し、displayDataDirPrefが呼び出される
			this._element("pref:dataDir.path").value = fp.file;
		}
	}

};


