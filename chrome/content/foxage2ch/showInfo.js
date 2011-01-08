////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://foxage2ch/utils.jsm");


////////////////////////////////////////////////////////////////////////////////
// ShowInfoUI

var ShowInfoUI = {

	item: null,

	changed: false,

	_element: function(aID) {
		return document.getElementById(aID);
	},

	init: function() {
		// 第1引数からアイテムID取得
		if (window.arguments.length < 1)
			throw Cr.NS_ERROR_INVALID_ARG;
		this.item = FoxAge2chUtils.service.getItem(window.arguments[0]);
		if (!this.item)
			throw Cr.NS_ERROR_INVALID_ARG;
		var bundle = this._element("infoBundle");
		var typeBoard     = this.item.type == FoxAge2chUtils.TYPE_BOARD;
		var typeThread    = this.item.type == FoxAge2chUtils.TYPE_THREAD;
		var typeSeparator = this.item.type == FoxAge2chUtils.TYPE_SEPARATOR;
		// タイトル
		this._element("titleField").value = this.item.title;
		// URL
		if (!typeSeparator) {
			this._element("urlRow").hidden = false;
			this._element("urlField").value = FoxAge2chUtils.parseToURL(this.item);
		}
		if (!typeSeparator) {
			// ステータス
			// XXX 複数のステータスがセットされている場合でもひとつしか表示しない
			this._element("statusRow").hidden = false;
			var status = "";
			if (this.item.status & FoxAge2chUtils.STATUS_UPDATED)
				status = "STATUS_UPDATED";
			else if (this.item.status & FoxAge2chUtils.STATUS_DATOUT)
				status = "STATUS_DATOUT";
			else if (this.item.status & FoxAge2chUtils.STATUS_ERROR)
				status = "STATUS_ERROR";
			else
				status = "STATUS_OK";
			this._element("statusField").value = bundle.getString(status);
			// 最大レス数
			this._element("maxResRow").hidden = false;
			this._element("maxResField").value = this.item.maxRes || 1000;
			this._element("maxResField").disabled = typeThread;
		}
		// 最終チェック
		if (typeBoard) {
			this._element("checkDateRow").hidden = false;
			var checkDate = this.item.checkDate
			              ? new Date(this.item.checkDate * 1000).toLocaleString() : "";
			this._element("checkDateField").value = checkDate;
		}
		// スレ立て日時・既読レス数・最終レス数
		// 一部の2ch宣伝スレのDATキーがスレ立て日時でないことに注意
		if (typeThread) {
			var key = parseInt(FoxAge2chUtils.threadKeyOfItem(this.item));
			var created = key < 9000000000 ? new Date(key * 1000).toLocaleString() : "";
			this._element("createdRow").hidden = false;
			this._element("readResRow").hidden = false;
			this._element("lastResRow").hidden = false;
			this._element("createdField").value = created;
			this._element("readResField").value = this.item.readRes;
			this._element("lastResField").value = this.item.lastRes;
		}
		// その他
		this._element("extra").hidden = typeSeparator;
		if (typeBoard) {
			this._element("skipField").checked = !!this.item.skip;
			var error = this.item.status & FoxAge2chUtils.STATUS_ERROR;
			this._element("excludeBoardError").disabled = !error;
			this._element("excludeBoardError").checked = !!this.item.exclude;
			this._element("excludeThreadError").hidden = true;
		}
		else if (typeThread) {
			this._element("skipField").hidden = true;
			var error = this.item.status & FoxAge2chUtils.STATUS_DATOUT || this.item.lastRes >= (this.item.maxRes || 1000);
			this._element("excludeThreadError").disabled = !error;
			this._element("excludeThreadError").checked = !!this.item.exclude;
			this._element("excludeBoardError").hidden = true;
		}
		// ダイアログのタイトル
		var title = "";
		if (typeBoard)
			title = "TYPE_BOARD";
		else if (typeThread)
			title = "TYPE_THREAD";
		else if (typeSeparator)
			title = "TYPE_SEPARATOR";
		document.title = bundle.getFormattedString("DIALOG_TITLE", [bundle.getString(title)]);
	},

	done: function() {
		if (!this.item || !this.changed)
			return;
		var typeBoard  = this.item.type == FoxAge2chUtils.TYPE_BOARD;
		var typeThread = this.item.type == FoxAge2chUtils.TYPE_THREAD;
		// タイトル
		var title = this._element("titleField").value;
		FoxAge2chUtils.service.changeItemProperty(this.item, "title", title);
		if (typeBoard) {
			// skip
			var skip = this._element("skipField").checked;
			FoxAge2chUtils.service.changeItemProperty(this.item, "skip", skip || undefined);
			// maxRes
			var maxRes = this._element("maxResField").valueNumber;
			maxRes = maxRes == 1000 ? undefined : maxRes;
			if (maxRes != this.item.maxRes) {
				// 板内の全スレッドのmaxResを更新する
				var threadItems = FoxAge2chUtils.service.getChildItems(this.item.id, {});
				threadItems.forEach(function(threadItem) {
					FoxAge2chUtils.service.changeItemProperty(threadItem, "maxRes", maxRes);
				});
				FoxAge2chUtils.service.changeItemProperty(this.item, "maxRes", maxRes);
				// スレッドエラー数(threadError)を更新する
				FoxAge2chUtils.service.updateItemStats(threadItems[0]);
			}
		}
		// exclude
		if (typeBoard || typeThread) {
			var exclude = this._element(typeBoard ? "excludeBoardError" : "excludeThreadError").checked;
			FoxAge2chUtils.service.changeItemProperty(this.item, "exclude", exclude || undefined);
			FoxAge2chUtils.service.updateItemStats(this.item);
		}
		FoxAge2chUtils.rebuildTree(null);
		this.item = null;
	},

};


