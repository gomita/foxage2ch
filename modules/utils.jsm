////////////////////////////////////////////////////////////////////////////////
// モジュール登録

var EXPORTED_SYMBOLS = ["FoxAge2chUtils"];

////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;


////////////////////////////////////////////////////////////////////////////////
// FoxAge2chUtils

const PREF_DOMAIN = "extensions.foxage2ch.";
const PREF_DATA_DIR_DEFAULT = "dataDir.default";
const PREF_DATA_DIR_PATH    = "dataDir.path";

const DEFAULT_DIR_NAME = "foxage2ch";

var FoxAge2chUtils = {

	TYPE_BOARD    : 1,
	TYPE_THREAD   : 2,
	TYPE_SEPARATOR: 3,

	BBS_2CH  : 1,
	BBS_PINK : 2,
	BBS_MACHI: 3,
	BBS_JBBS : 4,

	STATUS_CHECKING: 1,	// 0001(2)
	STATUS_UPDATED : 2,	// 0010(2)
	STATUS_DATOUT  : 4,	// 0100(2)
	STATUS_ERROR   : 8,	// 1000(2)

	VIEWER_NONE  : 0,
	VIEWER_BBS2CH: 1,
	VIEWER_P2REP2: 2,

	B2R_VER_04: 1,
	B2R_VER_05: 2,
	B2R_CHAIKA: 3,

	TOPIC_REBUILD_TREE: "foxage2ch-rebuild-tree",
	TOPIC_SHOW_MESSAGE: "foxage2ch-show-message",
	TOPIC_GLOBAL      : "foxage2ch-global",

	DROP_TYPE: "text/x-moz-tree-index",

	// nsIPrefBranch
	get prefs() {
		delete this.prefs;
		return this.prefs = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).
		                    getBranch(PREF_DOMAIN);
	},

	// nsIObserverService
	get observer() {
		delete this.observer;
		return this.observer = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
	},

	// nsIPromptService
	get prompt() {
		delete this.prompt;
		return this.prompt = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
	},

	// xdIFoxAge2chService
	get service() {
		delete this.service;
		return this.service = Cc["@xuldev.org/foxage2ch/service;1"].getService(Ci.xdIFoxAge2chService);
	},

	// chIChaikaService
	get chaikaService() {
		delete this.chaikaService;
		return this.chaikaService = Cc["@chaika.xrea.jp/chaika-service;1"].getService(Ci.chIChaikaService);
	},

	// bbs2ch service
	get bbs2chService() {
		delete this.bbs2chService;
		var svc;
		if (this.bbs2chVersion == this.B2R_VER_04)
			// [bbs2ch-0.4]
			svc = Cc["@mozilla.org/bbs2ch-service;1"].getService(Ci.nsIBbs2chService);
		else
			// [bbs2ch-0.5]
			svc = Cc["@bbs2ch.sourceforge.jp/b2r-global-service;1"].getService(Ci.b2rIGlobalService);
		return this.bbs2chService = svc;
	},

	// nsIConsoleService
	get console() {
		delete this.console;
		return this.console = Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService);
	},

	// nsIDragSession
	get dragSession() {
		if (!this._dragService)
			this._dragService = Cc["@mozilla.org/widget/dragservice;1"].getService(Ci.nsIDragService);
		return this._dragService.getCurrentSession();
	},

	// nsILocalFile データ保存先フォルダ
	// ファイルパスが不正の場合、NS_ERROR_FILE_UNRECOGNIZED_PATH
	get dataDir() {
		var dir = null;
		if (!this.prefs.getBoolPref(PREF_DATA_DIR_DEFAULT) && 
		     this.prefs.prefHasUserValue(PREF_DATA_DIR_PATH)) {
			// dataDir.defaultがfalseでなおかつdataDir.pathが設定済みの場合
			var path = this.prefs.getComplexValue(PREF_DATA_DIR_PATH, Ci.nsIPrefLocalizedString).data;
			dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
			dir.initWithPath(path);
		}
		else {
			// プロファイルフォルダ
			var dirSvc = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
			dir = dirSvc.get("ProfD", Ci.nsIFile);
			dir.append(DEFAULT_DIR_NAME);
			if (!dir.exists())
				dir.create(dir.DIRECTORY_TYPE, 0755);
		}
		return dir;
	},

	// propertiesファイルからローカライズされた文字列を取得する
	getLocaleString: function F2U_getLocaleString(aKey, aArgs) {
		if (!this._stringBundle) {
			const BUNDLE_URI = "chrome://foxage2ch/locale/foxage2ch.properties";
			var bundleSvc = Cc["@mozilla.org/intl/stringbundle;1"].getService(Ci.nsIStringBundleService);
			this._stringBundle = bundleSvc.createBundle(BUNDLE_URI);
		}
		try {
			if (!aArgs)
				return this._stringBundle.GetStringFromName(aKey);
			else
			    return this._stringBundle.formatStringFromName(aKey, aArgs, aArgs.length);
		}
		catch (ex) {
			return aKey;
		}
	},
	_stringBundle: null,

	// nsIURIオブジェクトを生成する
	makeURI: function F2U_makeURI(aURL) {
		var ioSvc = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
		return ioSvc.newURI(aURL, null, null);
	},

	// 「http://...http://」のようにビューアやWebサービスによってラップされたURLについて、
	// 最後のhttp://以降をURLとみなして返す
	unwrapURL: function F2U_unwrapURL(aURL) {
		var pos = aURL.lastIndexOf("http://");
		return pos >= 0 ? aURL.substr(pos) : aURL;
	},

	// 登録可能なURLをパースして、[板のアイテムID, スレッドのアイテムID] の配列へ変換する
	// 指定したURLのプロトコルが「http://」でない場合、 NS_ERROR_MALFORMED_URI 例外となる。
	// bbs2chreaderのURLやime.nuなどのURLを取り扱うためには、事前にunwrapURLしておくこと。
	// 指定したURLが登録不可である場合、 NS_ERROR_INVALID_ARG 例外となる。
	parseFromURL: function F2U_parseFromURL(aURL) {
		// unwrapURLは呼び出しもとのFoxAge2chUI.addURL側で実施する
		// aURL = this.unwrapURL(aURL);
		if (aURL.indexOf("http://") != 0)
			throw Cr.NS_ERROR_MALFORMED_URI;
		aURL = aURL.substr("http://".length);
		if (/\/test\/read\.(?:cgi|so|html)\/(\w+)\/(\d+)/.test(aURL))
			// ２ちゃんねるスレッド
			// http://pc7.2ch.net/test/read.cgi/software/1234567890/l50
			// [0] pc7.2ch.net/software
			// [1] pc7.2ch.net/software/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2
			];
		else if (/\/bbs\/read\.cgi\/(\w+)\/(\d+)\/(\d+)\//.test(aURL))
			// したらばスレッド
			// 注意: まちBBSスレッド用の正規表現と類似しているため、したらばの条件を優先しなければならない
			// http://jbbs.livedoor.jp/bbs/read.cgi/anime/1234/1234567890/l50
			// [0] jbbs.livedoor.jp/anime/1234
			// [1] jbbs.livedoor.jp/anime/1234/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2 + "/" + RegExp.$3
			];
		else if (/\/bbs\/read\.cgi\/(\w+)\/(\d+)\//.test(aURL))
			// まちBBSスレッド
			// http://kanto.machi.to/bbs/read.cgi/kana/1234567890
			// [0] kanto.machi.to/kana
			// [1] kanto.machi.to/kana/1234567890
			return [
				RegExp.leftContext + "/" + RegExp.$1,
				RegExp.leftContext + "/" + RegExp.$1 + "/" + RegExp.$2
			];
		else if (/\/read\.php\?host=([^&]+)&bbs=([^&]+)&key=([^&]+)/.test(aURL))
			// p2/rep2で開いたスレッド
			return [
				RegExp.$1 + "/" + RegExp.$2,
				RegExp.$1 + "/" + RegExp.$2 + "/" + RegExp.$3
			];
		else if (/\/subject\.php\?host=([^&]+)&bbs=([^&]+)/.test(aURL))
			// p2/rep2で開いた板
			return [
				RegExp.$1 + "/" + RegExp.$2,
				null
			];
		else if (/^\w+\.(?:2ch\.net|bbspink\.com|machi\.to)\/\w+\//.test(aURL) || 
		         /^jbbs\.shitaraba\.net\/\w+\/\d+\//.test(aURL))
			// ２ちゃんねる板・まちBBS板・したらば板
			return [
				aURL.substr(0, aURL.lastIndexOf("/")),
				null
			];
		else
			throw Cr.NS_ERROR_INVALID_ARG;
	},

	// 板またはスレッドのアイテムIDをパースしてURLへ変換する
	// @param bool aFixupForViewer trueならビューア用にURL変換を行う
	parseToURL: function F2U_parseToURL(aItem, aFixupForViewer) {
		var viewer = aFixupForViewer ? this.prefs.getIntPref("viewer.type") : this.VIEWER_NONE;
		if (aItem.type == this.TYPE_BOARD)
			return this._parseToBoardURL(aItem, viewer);
		else
			return this._parseToThreadURL(aItem, viewer);
	},

	// 板のアイテムIDをパースしてURLへ変換する
	_parseToBoardURL: function F2U__parseToBoardURL(aItem, aViewer) {
		if (aViewer == this.VIEWER_P2REP2) {
			var parts = aItem.id.split("/");
			var bbs = parts.pop();
			var host = parts.join("/");
			var baseURL = this.prefs.getComplexValue("viewer.url", Ci.nsISupportsString).data;
			return baseURL + "subject.php?host=" + host + "&bbs=" + bbs;
		}
		var url = "http://" + aItem.id + "/";
		if (aViewer == this.VIEWER_BBS2CH) {
			switch (this.bbs2chVersion) {
				case this.B2R_VER_04: 
				case this.B2R_VER_05: 
					// [bbs2ch-0.4][bbs2ch-0.5]
					url = "bbs2ch:board:" + url;
					break;
				case this.B2R_CHAIKA: 
					// [chaika]
					url = this.chaikaService.getBoardURI(this.makeURI(url)).spec;
					break;
			}
		}
		return url;
	},

	// スレッドのアイテムIDをパースしてURLへ変換する
	_parseToThreadURL: function F2U__parseToThreadURL(aItem, aViewer) {
		var parts = aItem.id.split("/");
		var key = parts.pop();
		var bbs = parts.pop();
		var host = parts.shift();
		var path = parts.join("/");
		if (aViewer == this.VIEWER_P2REP2) {
			host += path ? "/" + path : "";
			var baseURL = this.prefs.getComplexValue("viewer.url", Ci.nsISupportsString).data;
			return baseURL + "read.php?host=" + host + "&bbs=" + bbs + "&key=" + key + "&ls=";
		}
		var url = "http://";
		if (host == "jbbs.shitaraba.net")
			url += host + "/bbs/read.cgi/" + path + "/" + bbs + "/" + key + "/";
		else if (host.lastIndexOf(".machi.to") > 0)
			url += host + "/bbs/read.cgi/" + bbs + "/" + key + "/";
		else
			url += host + (path ? "/" + path : "") + "/test/read.cgi/" + bbs + "/" + key + "/";
		if (aViewer == this.VIEWER_BBS2CH) {
			switch (this.bbs2chVersion) {
				case this.B2R_VER_04: 
				case this.B2R_VER_05: 
					// [bbs2ch-0.4][bbs2ch-0.5]
					url = this.bbs2chService.serverURL.resolve("./thread/") + url;
					break;
				case this.B2R_CHAIKA: 
					// [chaika]
					url = this.chaikaService.getThreadURL(this.makeURI(url), false).spec;
					break;
			}
		}
		return url;
	},

	// ２ちゃんねるホームページのURL
	// ビューアがp2/rep2の場合はそのホームページを返す
	get homePageURL() {
		if (this.prefs.getIntPref("viewer.type") == this.VIEWER_P2REP2)
			return this.prefs.getComplexValue("viewer.url", Ci.nsISupportsString).data;
		else
			return "http://www.2ch.net/";
	},

	// アイテムのスレッドキー（dat番号）を取得する
	// pc11.2ch.net/software/1234567890 → 1234567890
	threadKeyOfItem: function F2U_threadKeyOfItem(aItem) {
		if (aItem.type != this.TYPE_THREAD)
			throw Cr.NS_ERROR_INVALID_ARG;
		return aItem.id.substr(aItem.id.lastIndexOf("/") + 1);
	},

	// URLをブラウザで開く
	loadURL: function F2U_loadURL(aURL, aInNewTab, aInBackground) {
		var win = Cc["@mozilla.org/appshell/window-mediator;1"].
		          getService(Ci.nsIWindowMediator).
		          getMostRecentWindow("navigator:browser");
		if (!win) {
			// ブラウザウィンドウがひとつも開かれていない場合、browser.xulを開く
			var winArg = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
			var winURI = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
			winURI.data = aURL;
			winArg.AppendElement(winURI);
			var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
			ww.openWindow(
				null, "chrome://browser/content/browser.xul", null, "chrome,dialog=no,all", winArg
			);
			return;
		}
		var tabBrowser = win.gBrowser;
		if (aInNewTab) {
			// 最後のタブが空白のタブなら新しいタブを開かない
			var browser = tabBrowser.getBrowserAtIndex(tabBrowser.mTabs.length - 1);
			if (browser == tabBrowser.mCurrentBrowser && 
				browser.currentURI.spec == "about:blank" && 
				!browser.webProgress.isLoadingDocument)
				aInNewTab = false;
		}
		// ピン留めしたタブを上書きしない
		if (!aInNewTab && tabBrowser.mCurrentTab.pinned)
			aInNewTab = true;
		if (aInNewTab)
			tabBrowser.loadOneTab(aURL, null, null, null, aInBackground, false);
		else
			tabBrowser.loadURI(aURL);
	},

	// HTTPで要求を行う際のUser-Agent文字列
	get userAgent() {
		const EXT_ID = "foxage2ch@xuldev.org";
		const UA_PREFIX = "Monazilla/1.00";
		Components.utils.import("resource://gre/modules/AddonManager.jsm");
		AddonManager.getAddonByID(EXT_ID, function(ext) {
			FoxAge2chUtils.trace("*** AddonManager.getAddonByID(" + ext.id + ")");	// #debug
			delete FoxAge2chUtils.userAgent;
			return FoxAge2chUtils.userAgent = UA_PREFIX + " (" + ext.name + "/" + ext.version + ")";
		});
		// 非同期で拡張機能の情報を取得するまでのフォールバック
		return UA_PREFIX;
	},

	// 拡張機能bbs2chreader / chaikaがインストールされていおり、なおかつ有効である場合、
	// B2R_VER_04 / B2R_VER_05 / B2R_CHAIKAのいずれかを返す。そうでない場合、nullを返す。
	get bbs2chVersion() {
		delete this.bbs2chVersion;
		if (Ci.chIChaikaService)
			// [chaika]
			return this.bbs2chVersion = this.B2R_CHAIKA;
		else if (Ci.b2rIGlobalService)
			// [bbs2ch-0.5]
			return this.bbs2chVersion = this.B2R_VER_05;
		else if (Ci.nsIBbs2chService)
			// [bbs2ch-0.4]
			return this.bbs2chVersion = this.B2R_VER_04;
		else
			// bbs2ch/chaikaともに未インストール
			return this.bbs2chVersion = null;
	},

	// トピックTOPIC_SHOW_MESSAGEでオブザーバへの通知を行う
	showMessage: function F2U_showMessage(aMessage) {
		this.observer.notifyObservers(null, this.TOPIC_SHOW_MESSAGE, aMessage);
	},

	// トピックTOPIC_REBUILD_TREEでオブザーバへの通知を行う
	// @param String aItemId ツリー全体の再構築ではなく特定アイテムの再描画の場合、そのアイテムIDをセットする
	rebuildTree: function F2U_rebuildTree(aItemId) {
		this.observer.notifyObservers(null, this.TOPIC_REBUILD_TREE, aItemId || null);
	},

	// HTTPRequestインスタンスを生成する
	createHTTPRequest: function F2U_createHTTPRequest() {
		return new HTTPRequest();
	},

	// 板のアイテムを生成する
	createBoardItem: function F2U_createBoardItem(aItemId, aTitle) {
		var bbs = this.BBS_2CH;
		if (aItemId.indexOf(".bbspink.com") >= 0)
			bbs = this.BBS_PINK;
		else if (aItemId.indexOf(".machi.to") >= 0)
			bbs = this.BBS_MACHI;
		else if (aItemId.indexOf("jbbs.shitaraba.net") >= 0)
			bbs = this.BBS_JBBS;
		return {
			id: aItemId,
			type: this.TYPE_BOARD,
			title: aTitle || aItemId,
			parent: "root",
			status: 0,
			bbs: bbs,
			checkDate: 0,
			open: false
		};
	},

	// スレッドのアイテムを生成する
	createThreadItem: function F2U_createThreadItem(aItemId, aBoardItem, aTitle) {
		return {
			id: aItemId,
			type: this.TYPE_THREAD,
			title: aTitle || aItemId,
			parent: aBoardItem.id,
			status: 0,
			readRes: 0,
			lastRes: 0,
			maxRes: aBoardItem.maxRes,
		};
	},

	// 区切りのアイテムを生成する
	createSeparatorItem: function F2U_createSeparatorItem(aTitle) {
		return {
			id: "separator:" + Date.now(),
			type: this.TYPE_SEPARATOR,
			title: aTitle || "",
			parent: "root",
		};
	},

	// 「&」「<」「>」「"」の実体参照をデコードする
	unescapeEntities: function F2U_unescapeEntities(aString) {
		aString = aString.replace(/&amp;/g, '&');
		aString = aString.replace(/&lt;/g, '<');
		aString = aString.replace(/&gt;/g, '>');
		aString = aString.replace(/&quot;/g, '"');
		return aString;
	},

	// タイトルの余計な文字列を削除する
	sanitizeTitle: function F2U_sanitizeTitle(aTitle) {
		aTitle = aTitle.replace("[\u8EE2\u8F09\u7981\u6B62]", "");	// [転載禁止]
		aTitle = aTitle.replace("&copy;2ch.net", "");	// ©2ch.net
		aTitle = aTitle.replace("&copy;bbspink.com", "");	// ©bbspink.com
		aTitle = aTitle.replace(/\u25A0|\u25C6|\u25CF|\u2605|\u2606/g, " ");	// ■,◆,●,★,☆
		aTitle = aTitle.replace(/[\u0000-\u001F]/g, "");	// 制御文字
		aTitle = aTitle.replace(/\s+/g, " ");	// 連続する空白
		aTitle = aTitle.replace(/^\s+|\s+$/g, "");	// 先頭・末尾の空白
		return aTitle;
	},

	// エラーコンソールへ文字列を出力し、エラーコンソールを開く
	reportError: function F2U_reportError(aMessage, aOpenConsole) {
		var err = Cc["@mozilla.org/scripterror;1"].createInstance(Ci.nsIScriptError);
		err.init(aMessage, null, null, null, null, err.errorFlag, "XPConnect JavaScript");
		this.console.logMessage(err);
		if (aOpenConsole === undefined || aOpenConsole) {
			var fuelApp = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication);
			fuelApp.console.open();
		}
	},

	// window.alert相当
	alert: function F2U_alert(aMessage) {
		this.prompt.alert(null, "FoxAge2ch", aMessage);
	},

	// #debug-begin
	assert: function F2U_assert(aCondition, aMessage, aDontStop) {
		if (aCondition)
			return;
		var caller = arguments.callee.caller;
		var assertionText = "ASSERT: " + aMessage + "\n";
		var stackText = "";
		stackText = "Stack Trace: \n";
		var count = 0;
		while (caller) {
			stackText += count++ + ": " + caller.name + "(";
			for (var i = 0; i < caller.arguments.length; ++i) {
				var arg = caller.arguments[i];
				stackText += arg;
				if (i < caller.arguments.length - 1)
					stackText += ", ";
			}
			stackText += ")\n";
			caller = caller.arguments.callee.caller;
		}
		aMessage = "ASSERT: " + aMessage + "\n" + stackText + "\n";
		this.alert(aMessage);
		if (!aDontStop)
			throw Cr.NS_OK;
	},

	trace: function F2U_trace(aMsg) {
		aMsg = aMsg ? aMsg + " " : "";
		var name = arguments.callee.caller.name;
		var args = Array.prototype.slice.call(arguments.callee.caller.arguments).join(", ");
		var time = new Date().toLocaleTimeString();
		this.console.logStringMessage(aMsg + name + " (" + args + ") " + time);
	},
	// #debug-end

};

// モジュールがインポートされた直後にUser-Agentを初期化
FoxAge2chUtils.userAgent;


////////////////////////////////////////////////////////////////////////////////
// HTTPでのリクエストを行うクラス

function HTTPRequest() {
	// インスタンスが処理中かどうかを表すフラグ。
	// インスタンス生成時にtrueとなり、
	// タイマー設定なしの場合、ロードコールバック／エラーコールバック直後にfalseとなる。
	// タイマー設定ありの場合、タイマーコールバック直前にfalseとなる。
	this.active = true;
}

HTTPRequest.prototype = {

	// nsIXMLHttpRequestのインスタンス
	_request: null,

	// nsITimerのインスタンス
	_timer: null,

	// 必要に応じて関連アイテムのIDをセットする
	itemId: null,

	// 必要に応じてインスタンス生成元オブジェクトへの参照をセットする
	owner: null,

	// 各種コールバック関数
	_loadCallback : function(aResponseText) {},
	_errorCallback: function(aHttpStatus) {},
	_timerCallback: function() {},

	// 指定したURLへGETメソッドでリクエストを送信する
	// @param string aURL 接続先URL
	// @param function aLoadCallback 正常レスポンス時のコールバック関数。引数はレスポンステキスト。
	// @param function aErrorCallback 異常レスポンス時のコールバック関数。引数はHTTPステータス。
	// @param function aTimerCallback レスポンス処理後の小休止後に発動するタイマーのコールバック関数。
	//                                指定しなければタイマーは発動しない。
	send: function HR_send(aURL, aLoadCallback, aErrorCallback, aTimerCallback) {
		this._loadCallback  = aLoadCallback;
		this._errorCallback = aErrorCallback;
		this._timerCallback = aTimerCallback;
		this._request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();
		this._request.QueryInterface(Ci.nsIDOMEventTarget);
		this._request.addEventListener("load", this, false);
		this._request.addEventListener("error", this, false);
		this._request.QueryInterface(Ci.nsIXMLHttpRequest);
		this._request.open("GET", aURL, true);
		this._request.setRequestHeader("User-Agent", FoxAge2chUtils.userAgent);
		this._request.channel.contentCharset = aURL.indexOf("jbbs.shitaraba.net") >= 0 ? "EUC-JP" : "Shift_JIS";
		this._request.send(null);
	},

	// リクエストを送信せずにタイマーだけ発動させる
	// @param function aTimerCallback タイマーのコールバック関数。
	// @param number aDelay タイムアウト時間 (ミリ秒)。デフォルト200ミリ秒。
	setTimeout: function HR_setTimeout(aTimerCallback, aDelay) {
		if (aTimerCallback)
			this._timerCallback = aTimerCallback;
		this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
		this._timer.initWithCallback(this, aDelay || 200, Ci.nsITimer.TYPE_ONE_SHOT);
	},

	// 仕掛かり中の処理をすべて中止して他オブジェクトへの参照を破棄する。
	destroy: function HR_destroy() {
		if (this._request) {
			this._request.abort();
			this._request = null;
		}
		if (this._timer) {
			this._timer.cancel();
			this._timer = null;
		}
		if (this.owner)
			this.owner = null;
		this._loadCallback = null;
		this._errorCallback = null;
		this._timerCallback = null;
		this.itemId = null;
		this.active = false;
	},

	////////////////////////////////////////////////////////////////////////////////
	// nsIDOMEventListener

	handleEvent: function HR_handleEvent(aEvent) {
		try {
			var validateURL = function(aChannel) {
				var errorURLs = [
					"http://www2.2ch.net/nogood.html", 
					"http://www2.2ch.net/live.html", 
					"http://server.maido3.com/"
				];
				// #debug-begin
				if (errorURLs.indexOf(aChannel.URI.spec) >= 0) {
					var msg = aChannel.originalURI.spec + " -> " + aChannel.URI.spec;
					FoxAge2chUtils.reportError("Redirected:\n" + msg);
				}
				// #debug-end
				return errorURLs.indexOf(aChannel.URI.spec) >= 0;
			};
			// 一部の鯖（uni.2ch.netなど）で、移転済みにも関わらずsubject.txtがリダイレクトされず
			// HTTPステータス200で返ってくるため、その中身まで見ないと移転済みかを判別できない。
			var validateResponse = function(aText) {
				if (!aText)
					return false;
				var lines = aText.split("\n");
				return (
					lines.length == 3 && 
					lines[0].indexOf("9246366142.dat<>") == 0 && 
					lines[1].indexOf("9248888888.dat<>") == 0
				);
			};
			if (aEvent.type == "load" && this._request.status == 200 && 
			    !validateURL(this._request.channel) && 
			    !validateResponse(this._request.responseText))
				// ステータス200でなおかつレスポンステキストありでなおかつ人大杉でない
				this._loadCallback(this._request.responseText);
			else
				// ステータス0 (ソケットエラー)
				// ステータス302 (人大杉)
				// ステータス403 (バーボンハウス)
				// レスポンステキストなし (移転済み板のsubject.txt)
				// 9246366142.datと9248888888.datしかない (移転済み)
				// http://www2.2ch.net/live.html (人大杉)
				// http://server.maido3.com/ (移転済み？)
				this._errorCallback(this._request.status);
		}
		catch (ex) { FoxAge2chUtils.assert(false, "HTTPRequest Error: " + ex); }	// #debug
		finally {
			this._request.removeEventListener("load", this, false);
			this._request.removeEventListener("error", this, false);
			this._request.abort();	// 不要？
			this._request = null;
		}
		if (this._timerCallback)
			this.setTimeout(null);
		else
			this.destroy();
	},

	////////////////////////////////////////////////////////////////////////////////
	// nsITimerCallback

	notify: function HR_notify(aTimer) {
		this.active = false;
		this._timerCallback();
	}

};


