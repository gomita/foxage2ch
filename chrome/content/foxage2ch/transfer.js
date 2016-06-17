const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://foxage2ch/utils.jsm");

var TransferWizard = {

	// 移転元の板のアイテム
	boardItem: null,

	// xul:wizard
	wizard: null,

	// xul:stringbundle
	bundle: null,

	// HTTPRequestインスタンス
	httpReq: null,

	init: function() {
		if (window.arguments.length != 1)
			throw Cr.NS_ERROR_INVALID_ARG;
		this.boardItem = FoxAge2chUtils.service.getItem(window.arguments[0]);
		if (!this.boardItem)
			throw Cr.NS_ERROR_UNEXPECTED;
		this.wizard = document.getElementById("transferWizard");
		this.bundle = document.getElementById("transferBundle");
		var url = FoxAge2chUtils.parseToURL(this.boardItem);
		var errorCallback = function(aStatus) {
			this.owner.trace(FoxAge2chUtils.getLocaleString("ERROR") + " (" + aStatus + ")");
			// ウィザード: メーター非表示・完了×・キャンセル○
			document.getElementById("meter").collapsed = true;
			this.owner.wizard.getButton("finish").disabled = false;
			this.owner.wizard.getButton("cancel").disabled = false;
		};
		var loadCallback = function(aResponseText) {
			if (!/<title>(?:2chbbs|bbspink)\.\.<\/title>/.test(aResponseText) || 
			    aResponseText.indexOf("Change your bookmark ASAP.") < 0 || 
			    !/window\.location\.href=\"([^\"]+)\"/.test(aResponseText)) {
				this._errorCallback(this.owner.bundle.getString("DETECT_FAILURE"));
				return;
			}
			try {
				this.owner.doTransfer(RegExp.$1);
			}
			catch (ex) {
				this._errorCallback(ex);
				return;
			}
			// ウィザード: メーター非表示・完了○・キャンセル×
			document.getElementById("meter").collapsed = true;
			this.owner.wizard.getButton("finish").disabled = false;
			this.owner.wizard.getButton("cancel").disabled = true;
		};
		this.httpReq = FoxAge2chUtils.createHTTPRequest();
		this.httpReq.owner = this;
		this.httpReq.send(url, loadCallback, errorCallback);
		this.trace(FoxAge2chUtils.getLocaleString("CHECKING") + ": " + this.boardItem.title);
		// ウィザード: メーター表示・完了○
		document.getElementById("meter").collapsed = false;
		this.wizard.getButton("finish").disabled = true;
	},

	done: function() {
		if (this.httpReq) {
			this.httpReq.destroy();
			this.httpReq = null;
		}
		this.bundle = null;
		this.wizard = null;
		this.boardItem = null;
	},

	doTransfer: function(aNewURL) {
		// pc7.2ch.net/software → pc7.2ch.net
		var oldHost = this.boardItem.id.substr(0, this.boardItem.id.indexOf("/"));
		// http://pc11.2ch.net/software/ → pc11.2ch.net
		if (!/^http:\/\/([^\/]+)\//.test(aNewURL))
			throw Cr.NS_ERROR_UNEXPECTED;
		var newHost = RegExp.$1;
		this.trace(this.bundle.getString("DETECT_SUCCESS") + ": " + oldHost + " \u2192 " + newHost);
		// 移転先の板を追加
		var newBoardItem = FoxAge2chUtils.createBoardItem(this.boardItem.id.replace(oldHost, newHost));
		newBoardItem.status = this.boardItem.status;
		newBoardItem.unread = this.boardItem.unread;
		newBoardItem.skip   = this.boardItem.skip;
		newBoardItem.maxRes = this.boardItem.maxRes;
		newBoardItem.error  = this.boardItem.error;
		if (newBoardItem.status & FoxAge2chUtils.STATUS_ERROR)
			// エラーのステータスフラグは引き継がない
			newBoardItem.status ^= FoxAge2chUtils.STATUS_ERROR;
		if (FoxAge2chUtils.service.getItem(newBoardItem.id)) {
			// 移転先の板がすでに存在する
			this.trace(FoxAge2chUtils.getLocaleString("ALREADY_ADDED") + ": " + this.boardItem.title);
		}
		else {
			FoxAge2chUtils.service.insertItem(newBoardItem, this.boardItem);
			this.trace(this.bundle.getString("ADD_BOARD") + ": " + this.boardItem.title);
		}
		// 移転先のスレッドを追加
		FoxAge2chUtils.service.getChildItems(this.boardItem.id, {}).forEach(function(threadItem) {
			var newItemId = threadItem.id.replace(oldHost, newHost);
			var newThreadItem = FoxAge2chUtils.createThreadItem(newItemId, newBoardItem, threadItem.title);
			newThreadItem.status = threadItem.status;
			newThreadItem.readRes = threadItem.readRes;
			newThreadItem.lastRes = threadItem.lastRes;
			newThreadItem.exclude = threadItem.exclude;
			if (FoxAge2chUtils.service.getItem(newItemId)) {
				// 移転先のスレッドがすでに存在する
				this.trace(FoxAge2chUtils.getLocaleString("ALREADY_ADDED") + ": " + threadItem.title);
			}
			else {
				FoxAge2chUtils.service.insertItem(newThreadItem, null);
				this.trace(this.bundle.getString("ADD_THREAD") + ": " + threadItem.title);
			}
		}, this);
		FoxAge2chUtils.service.updateItemStats(newBoardItem);
		// ツリー操作
		var opener = window.opener.wrappedJSObject || window.opener;
		var FoxAge2chUI = opener.FoxAge2chUI;
		FoxAge2chUI.mainView.selectIndex(FoxAge2chUI.mainView.treeIndexForItem(newBoardItem));
		if (FoxAge2chUI.subView)
			// 2ペインモード: サブペインを開く
			FoxAge2chUI.showSubPane(newBoardItem);
		// 移転先の板のタイトルを取得
		FoxAge2chUtils.service.fetchTitle(newBoardItem);
		this.trace(FoxAge2chUtils.getLocaleString("SUCCESS"));
	},

	trace: function(aMessage) {
		aMessage = aMessage.replace(/\r|\n|\t/g, " ");
		var listbox = document.getElementById("tracer");
		var listitem = listbox.appendItem(aMessage);
		listbox.selectItem(listitem);
		listbox.ensureElementIsVisible(listitem);
	}

};


