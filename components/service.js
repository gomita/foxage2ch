////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

// #debug-begin
function LOG(aMessage, aTimeStamp) {
	if (aTimeStamp)
		aMessage += "\t@" + new Date().toLocaleTimeString();
	dump("FoxAge2ch> " + aMessage + "\n");
}
// #debug-end

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const JSON_FILE_NAME = "foxage2ch.json";
const FLUSH_DELAY = 10000;
const PREF_DOMAIN = "extensions.foxage2ch.";


////////////////////////////////////////////////////////////////////////////////
// FoxAge2chService

function FoxAge2chService() {
	Components.utils.import("resource://foxage2ch/utils.jsm");
	this._init();
}

FoxAge2chService.prototype = {

	classDescription: "FoxAge2ch Service",
	contractID: "@xuldev.org/foxage2ch/service;1",
	classID: Components.ID("{19d6d8b4-bd62-45f2-b8fa-c4a58b0f9fbe}"),
	QueryInterface: XPCOMUtils.generateQI([
		Ci.nsIObserver,
		Ci.nsISupports,
		Ci.xdIFoxAge2chService
	]),

	_init: function F2S__init() {
		LOG("service init");	// #debug
		this._readData();
		this._archiveData();
		FoxAge2chUtils.observer.addObserver(this, "quit-application", false);
		var prefBranch2 = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch2);
		prefBranch2.addObserver(PREF_DOMAIN, this, false);
		AutoCheck.init();
	},

	_destroy: function F2S__destroy() {
		LOG("service destroy");	// #debug
		AutoCheck.uninit();
		this.checkUpdates(null);
		this.openUpdates(null);
		FoxAge2chUtils.observer.removeObserver(this, "quit-application");
		var prefBranch2 = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch2);
		prefBranch2.removeObserver(PREF_DOMAIN, this);
		if (this._flushTimer) {
			this._flushData();
			this._flushTimer.cancel();
			this._flushTimer = null;
		}
		this._indexForItemId = null;
		this._allItems = null;
		this._dataFile = null;
	},

	get jsonParser() {
		var parser = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
		this.__defineGetter__("jsonParser", function() parser);
		return parser;
	},

	// nsILocalFile
	_dataFile: null,

	_readData: function F2S__readData() {
		// 例外発生を考慮してあらかじめプロパティを初期化
		this._dataFile = null;
		this._allItems = [];
		this._updateIndexForItemId();
		try {
			this._dataFile = FoxAge2chUtils.dataDir;
			this._dataFile.append(JSON_FILE_NAME);
			if (!this._dataFile.exists() || this._dataFile.fileSize == 0) {
				// 新規ファイル生成
				this._allItems = [{ id: "root" }];
				this._flushData();
			}
			// ファイルから読み込み
			var istream = Cc["@mozilla.org/network/file-input-stream;1"].
			              createInstance(Ci.nsIFileInputStream);
			istream.init(this._dataFile, 1, 0, false);
			this._allItems = this.jsonParser.decodeFromStream(istream, istream.available());
			istream.close();
			this._updateIndexForItemId();
		}
		catch (ex) {
			Components.utils.reportError(ex);
			var msg = "";
			if (ex.result == Cr.NS_ERROR_FILE_UNRECOGNIZED_PATH)
				// nsILocalFile::initWithPath でスローされた例外
				msg = FoxAge2chUtils.getLocaleString("ERROR_UNRECOGNIZED_PATH");
			else if (ex.result == Cr.NS_ERROR_FAILURE)
				// nsIJSON::decodeFromString でスローされた例外
				msg = FoxAge2chUtils.getLocaleString("ERROR_PARSE_FAILURE", [JSON_FILE_NAME]);
			else
				// その他の例外
				msg = FoxAge2chUtils.getLocaleString("ERROR_UNKNOWN") + "\n" + ex;
			FoxAge2chUtils.alert(FoxAge2chUtils.getLocaleString("ERROR_READ_FAILURE") + "\n" + msg);
		}
	},

	// データファイルのバックアップ生成と古いバックアップの削除を行う
	// バックアップファイルは現在のデータ保存先フォルダの下のbackupsフォルダ以下に生成される。
	// バックアップファイルのファイル名は自動的に決定される。
	// 注意: このメソッドを呼び出す前に_readDataメソッドを実行しておく必要がある。
	_archiveData: function F2S__archiveData() {
		if (!this._dataFile)
			return;
		try {
			var maxBackups = FoxAge2chUtils.prefs.getIntPref("maxBackups");
			if (maxBackups <= 0 || this._dataFile.fileSize == 0)
				// サイズが0KBの場合はバックアップしない
				return;
			var backupDir = this._dataFile.parent;
			backupDir.append("backups");
			if (!backupDir.exists())
				backupDir.create(backupDir.DIRECTORY_TYPE, 0700);
			var backupFileName = "foxage2ch-" + new Date().toLocaleFormat("%Y-%m-%d") + ".json";
			var backupFile = backupDir.clone();
			backupFile.append(backupFileName);
			if (backupFile.exists())
				return;
			this._dataFile.copyTo(backupDir, backupFileName);
			FoxAge2chUtils.fuelApp.console.log("Create new backup file: " + backupFileName);	// #debug
			// 古いバックアップファイルを削除
			var backupNames = [];
			var entries = backupDir.directoryEntries;
			while (entries.hasMoreElements()) {
				var entry = entries.getNext().QueryInterface(Ci.nsIFile);
				var backupName = entry.leafName;
				if (/^foxage2ch-\d{4}-\d{2}-\d{2}\.json$/.test(backupName))
					backupNames.push(backupName);
			}
			backupNames.sort();
			LOG("backupNames: " + backupNames.toString());	// #debug
			while (backupNames.length > maxBackups) {
				var backupName = backupNames.shift();
				let backupFile = backupDir.clone();
				backupFile.append(backupName);
				backupFile.remove(false);
				FoxAge2chUtils.fuelApp.console.log("Remove old backup file: " + backupFile.leafName);	// #debug
			}
		}
		catch (ex) {
			Components.utils.reportError(ex);
			FoxAge2chUtils.assert(false, "Error while archiving data.\n" + ex, true);	// #debug
		}
	},

	_flushDataWithDelay: function F2S__flushDataWithDelay() {
		// タイマー作動中は何もしない
		if (this._flushTimer)
			return;
		this._flushTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
		this._flushTimer.init(this, FLUSH_DELAY, Ci.nsITimer.TYPE_ONE_SHOT);
	},

	_flushTimer: null,

	_flushData: function F2S__flushData() {
		try {
			var jsonStr = this.jsonParser.encode(this._allItems);
			// UTF-8へ変換
			const uniConv = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
			                getService(Ci.nsIScriptableUnicodeConverter);
			uniConv.charset = "UTF-8";
			jsonStr = uniConv.ConvertFromUnicode(jsonStr);
			var stream = Cc["@mozilla.org/network/file-output-stream;1"].
			             createInstance(Ci.nsIFileOutputStream);
			// modeFlags: PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE
			stream.init(this._dataFile, 0x02 | 0x08 | 0x20, 0644, 0);
			stream.write(jsonStr, jsonStr.length);
			stream.close();
		}
		catch (ex) {
			// NS_ERROR_FILE_ACCESS_DENIED（ファイルが読み取り専用）
			FoxAge2chUtils.alert(FoxAge2chUtils.getLocaleString("ERROR_WRITE_FAILURE") + "\n\n" + ex);
			Components.utils.reportError(ex);
		}
		LOG("_flushData ", true);	// #debug
	},

	// データファイルを再読み込みしてデータを更新する
	// 「バックアップから復元」や「インポート」を実行した後にこのメソッドを呼び出す。
	reloadData: function F2S_reloadData() {
		this.checkUpdates(null);
		this.openUpdates(null);
		this._readData();
		FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "reload-data");
		AutoCheck.init();
	},

	////////////////////////////////////////////////////////////////////////////////
	// データ操作

	// すべてのアイテムの配列
	_allItems: null,

	// 指定したアイテムIDに対応するアイテムを取得する
	getItem: function F2S_getItem(aItemId) {
		if (aItemId in this._indexForItemId) {
			var item = this._allItems[this._indexForItemId[aItemId]];
			FoxAge2chUtils.assert(item.id == aItemId, "_indexForItemId");	// #debug
			return item;
		}
		return null;
	},

	// getItemを高速化するためのハッシュ
	// キー: アイテムid, 値: _allItems中の配列番号
	// @see _updateIndexForItemId
	_indexForItemId: null,

	// _indexForItemIdを更新する
	// _allItems配列に対して以下の操作を行った場合、このメソッドを呼び出す必要がある
	//   アイテム生成時: _readData
	//   アイテム追加時: insertItem, insertSeparator
	//   アイテム削除時: removeItem
	//   アイテム移動時: moveItem, _manipulateDataWithSubjectTxt
	// @see _indexForItemId
	_updateIndexForItemId: function F2S__updateIndexForItemId() {
		this._indexForItemId = {};
		for (var i = 0; i < this._allItems.length; i++) {
			this._indexForItemId[this._allItems[i].id] = i;
		}
	},

	// 指定したアイテムIDを親とするすべてのアイテムの配列を取得する
	getChildItems: function F2S_getChildItems(aParentId, aItemsCount) {
		var items = this._allItems.filter(function(item) {
			return (item.parent == aParentId);
		});
		aItemsCount.value = items.length;
		return items;
	},

	// 新たに生成したアイテムを追加する
	// 同一IDのアイテムがすでに存在する場合、NS_ERROR_ABORT
	insertItem: function F2S_insertItem(aNewItem, aRefItem) {
		// 既存IDの追加を防止
		if (this.getItem(aNewItem.id))
			throw Cr.NS_ERROR_ABORT;
		var updatedThread = (aNewItem.type == FoxAge2chUtils.TYPE_THREAD && 
		                     aNewItem.status & FoxAge2chUtils.STATUS_UPDATED);
		if (updatedThread)
			// 先頭へ追加
			this._allItems.splice(1, 0, aNewItem);
		else if (aRefItem)
			// 指定した位置へ追加
			this._allItems.splice(this._allItems.indexOf(aRefItem), 0, aNewItem);
		else
			// 末尾へ追加
			this._allItems.push(aNewItem);
		this._updateIndexForItemId();
		if (updatedThread)
			this._updateBoardStats(this.getItem(aNewItem.parent));
		this._flushDataWithDelay();
		FoxAge2chUtils.rebuildTree();
	},

	// 指定したアイテム (板またはスレッド) をブラウザで開く
	openItem: function F2S_openItem(aItem, aInNewTab, aInBackground) {
		var url = FoxAge2chUtils.parseToURL(aItem, true);
		if (aItem.type == FoxAge2chUtils.TYPE_THREAD) {
			var upwardMargin = FoxAge2chUtils.prefs.getIntPref("upwardMargin");
			// upwardMarginが負の場合、すべてのレスを表示
			if (upwardMargin >= 0) {
				if (FoxAge2chUtils.prefs.getIntPref("viewer.type") == FoxAge2chUtils.VIEWER_BBS2CH) {
					// [bbs2ch] ログピックアップモードを回避
					url += "l" + upwardMargin;
				}
				else {
					if (!aItem.lastRes)
						// 初回: 最新50レス
						url += "l50";
					else {
						// 2回目以降: readRes - さかのぼり表示差分 ～ lastRes
						var startRes = (aItem.readRes || 0) - upwardMargin + 1;
						if (startRes < 1)
							// さかのぼり表示で開始スレ番号が負になるのを防ぐ
							startRes = 1;
						if (startRes > aItem.lastRes)
							// upwardMarginが0で未読レスが無い場合、startRes > lastResとなるのを防ぐ
							startRes = aItem.lastRes;
						url += startRes.toString() + "-" + aItem.lastRes.toString();
						if (startRes > 1)
							// 1表示を抑止
							url += "n";
					}
				}
			}
			if (aItem.status & FoxAge2chUtils.STATUS_UPDATED) {
				// スレッドのステータスを既読へ変更
				this._removeStatusFlag(aItem, FoxAge2chUtils.STATUS_UPDATED);
				this.changeItemProperty(aItem, "readRes", aItem.lastRes);
				// 板の未読スレッド数・ステータスを変更
				this._updateBoardStats(this.getItem(aItem.parent));
				FoxAge2chUtils.rebuildTree(aItem.id);
				FoxAge2chUtils.rebuildTree(aItem.parent);
			}
		}
		FoxAge2chUtils.loadURL(url, aInNewTab, aInBackground);
	},

	// 指定したアイテムのツリー上での位置を移動する
	moveItem: function F2S_moveItem(aItem, aRefItem) {
		var sourceIndex = this._allItems.indexOf(aItem);
		var targetIndex = this._allItems.indexOf(aRefItem);
		var removedItems = this._allItems.splice(sourceIndex, 1);
		this._allItems.splice(targetIndex, 0, removedItems[0]);
		this._updateIndexForItemId();
		this._flushDataWithDelay();
		FoxAge2chUtils.rebuildTree();
	},

	// 指定したアイテムを削除する
	removeItem: function F2S_removeItem(aItem) {
		var removedCount = 0;
		var removedItems = [aItem];
		if (aItem.type == FoxAge2chUtils.TYPE_BOARD)
			removedItems = removedItems.concat(this.getChildItems(aItem.id, {}));
		// 後から順番に削除する
		removedItems.reverse().forEach(function(removedItem) {
			// LOG("deleted: " + removedItem.title);	// #debug
			var index = this._allItems.indexOf(removedItem);
			this._allItems.splice(index, 1);
			removedCount++;
		}, this);
		this._updateIndexForItemId();
		if (aItem.type == FoxAge2chUtils.TYPE_THREAD)
			// スレを削除した場合、親の板の未読スレッド数を更新する
			this._updateBoardStats(this.getItem(aItem.parent));
		else if (aItem.type == FoxAge2chUtils.TYPE_BOARD)
			// 板を削除した場合、ルートのdat落ちスレッド数を更新する
			this._updateRootStats();
		this._flushDataWithDelay();
		FoxAge2chUtils.rebuildTree();
		FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("DELETE_ITEMS", [removedCount]));
	},

	// アイテムのプロパティを変更する
	changeItemProperty: function F2S_changeItemProperty(aItem, aProperty, aValue) {
		if (aValue === undefined)
			delete aItem[aProperty];
		else
			aItem[aProperty] = aValue;
		this._flushDataWithDelay();
	},

	_addStatusFlag: function F2S__addStatusFlag(aItem, aFlag) {
		if (aItem.status & aFlag)
			return;
		this.changeItemProperty(aItem, "status", aItem.status | aFlag);
	},

	_removeStatusFlag: function F2S__removeStatusFlag(aItem, aFlag) {
		if (aItem.status & aFlag)
			this.changeItemProperty(aItem, "status", aItem.status ^ aFlag);
	},

	// アイテムに関連する統計データを更新する
	updateItemStats: function F2S_updateStats(aItem) {
		if (aItem.type == FoxAge2chUtils.TYPE_THREAD)
			this._updateBoardStats(this.getItem(aItem.parent));
		else if (aItem.type == FoxAge2chUtils.TYPE_BOARD)
			this._updateRootStats();
	},

	// 板の未読スレッド数(unread)・dat落ちスレッド数(error)・ステータスを更新する
	// @param aBoardItem 板のアイテム
	_updateBoardStats: function F2S__updateBoardStats(aBoardItem) {
		var threadItems = this.getChildItems(aBoardItem.id, {});
		var unread = 0, error = 0;
		threadItems.forEach(function(threadItem) {
			if (threadItem.status & FoxAge2chUtils.STATUS_UPDATED)
				unread++;
			// 未読かつdat落ちというステータスがありえるため「else if」にしない
			if (!threadItem.exclude && 
			    (threadItem.status & FoxAge2chUtils.STATUS_DATOUT || threadItem.lastRes >= (threadItem.maxRes || 1000)))
				error++;
		});
		if (unread > 0)
			this._addStatusFlag(aBoardItem, FoxAge2chUtils.STATUS_UPDATED);
		else
			this._removeStatusFlag(aBoardItem, FoxAge2chUtils.STATUS_UPDATED);
		this.changeItemProperty(aBoardItem, "unread", unread == 0 ? undefined : unread);
		if (error != (aBoardItem.error || 0)) {
			// 板のerrorプロパティに変化あり
			this.changeItemProperty(aBoardItem, "error", error == 0 ? undefined : error);
			this._updateRootStats();
		}
	},

	// ルートの板エラー数(boardError)・スレッドエラー数(threadError)を更新する
	_updateRootStats: function F2S__updateRootStats() {
		FoxAge2chUtils.trace();	// #debug
		var boardError = 0, threadError = 0;
		this.getChildItems("root", {}).forEach(function(boardItem) {
			if (!boardItem.exclude && boardItem.status & FoxAge2chUtils.STATUS_ERROR)
				boardError++;
			threadError += (boardItem.error || 0);
		});
		var rootItem = this.getItem("root");
		if (boardError == (rootItem.boardError || 0) && threadError == (rootItem.threadError || 0))
			// dat落ちスレッドを含まない板を削除した場合、合計dat落ちスレッド数に変化なし
			return;
		this.changeItemProperty(rootItem, "boardError", boardError == 0 ? undefined : boardError);
		this.changeItemProperty(rootItem, "threadError", threadError == 0 ? undefined : threadError);
		FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "error-notify");
	},

	_manipulateDataWithSubjectTxt: function F2S__manipulateDataWithSubjectTxt(aBoardItem, aSubjectTxt) {
		// 「dat2thread[%dat番号%] = %スレッドアイテム%」でハッシュ化
		var dat2thread = {};
		this.getChildItems(aBoardItem.id, {}).forEach(function(threadItem) {
			dat2thread[FoxAge2chUtils.threadKeyOfItem(threadItem)] = threadItem;
		});
		var unread = 0;
		// subject.txtの各行を処理
		// 注意: 更新があったスレを先頭に移動させるため、最終行から順番に処理する
		aSubjectTxt.split("\n").reverse().forEach(function(line) {
			// ２ちゃんねる     : %dat番号%.dat<>%スレタイトル% (%レス数%)
			// まちBBS・したらば: %dat番号%.cgi,%スレタイトル%(%レス数%)
			if (!/^(\d+)\.(?:dat<>|cgi,).+\((\d{1,4})\)$/.test(line))
				return;
			var dat = RegExp.$1;
			if (!(dat in dat2thread))
				return;
			var threadItem = dat2thread[dat];
			var lastRes = threadItem.lastRes || 0;
			var newRes = parseInt(RegExp.$2, 10);
			this.changeItemProperty(threadItem, "lastRes", newRes);
			// incorrect dat-out detectionからの復帰
			// @see http://www.xuldev.org/foxage2ch/feedback.php?mode=single&n=64
			this._removeStatusFlag(threadItem, FoxAge2chUtils.STATUS_DATOUT);
			if (newRes > lastRes) {
				this._addStatusFlag(threadItem, FoxAge2chUtils.STATUS_UPDATED);
				// スレのアイテムを先頭（ルートの直後）へ移動
				var threadIndex = this._allItems.indexOf(threadItem);
				var removedItems = this._allItems.splice(threadIndex, 1);
				this._allItems.splice(1, 0, removedItems[0]);
				unread++;
			}
			// #debug-begin
			if (threadItem.status & FoxAge2chUtils.STATUS_DATOUT)
				FoxAge2chUtils.reportError("incorrect dat-out detection: " + threadItem.title);
			// LOG((newRes > lastRes ? "\t* " : "\t  ") + threadItem.id + "\t" + lastRes + " -> " + newRes);
			// #debug-end
			delete dat2thread[dat];
		}, this);
		this._updateIndexForItemId();
		// subject.txtに存在しない＝dat落ちスレの処理
		for (var dat in dat2thread) {
			var threadItem = dat2thread[dat];
			// LOG("\tx " + threadItem.id);	// #debug
			this._removeStatusFlag(threadItem, FoxAge2chUtils.STATUS_UPDATED);
			this._addStatusFlag(threadItem, FoxAge2chUtils.STATUS_DATOUT);
			delete dat2thread[dat];
		}
		// メッセージ表示
		var msg = unread > 0 ? FoxAge2chUtils.getLocaleString("UPDATED", [unread])
		                     : FoxAge2chUtils.getLocaleString("NO_UPDATED");
		FoxAge2chUtils.showMessage(msg + ": " + aBoardItem.title);
		// 板のプロパティを更新
		this._updateBoardStats(aBoardItem);
		this.changeItemProperty(aBoardItem, "checkDate", Math.floor(new Date().getTime() / 1000));
		FoxAge2chUtils.rebuildTree();
	},

	////////////////////////////////////////////////////////////////////////////////
	// 更新チェック

	// 更新チェック処理待ちの板アイテムIDの配列
	_checkUpdatesQueue: [],

	// 更新チェック処理中のHTTPRequestインスタンスの配列
	_checkUpdatesRequests: [],

	// 更新チェック
	checkUpdates: function F2S_checkUpdates(aItemId) {
		// aItemIdが"root"の場合、すべての板についてcheckUpdatesを再帰的に呼び出し
		if (aItemId == "root") {
			this.getChildItems("root", {}).forEach(function(item) {
				// skip: trueの板は対象外
				if (item.type == FoxAge2chUtils.TYPE_BOARD && !item.skip && item.id != "root")
					this.checkUpdates(item.id);
			}, this);
			return;
		}
		// aItemIdがnullの場合、更新チェックを中止する
		if (!aItemId) {
			this._cancelAllRequests();
			return;
		}
		// キューへの二重登録を制限
		if (this._checkUpdatesQueue.indexOf(aItemId) >= 0)
			return;
		// 二重チェックを制限
		for (var i = 0; i < this._checkUpdatesRequests.length; i++) {
			if (this._checkUpdatesRequests[i].itemId == aItemId)
				return;
		}
		this._checkUpdatesQueue.push(aItemId);
		this._checkUpdatesNext();
	},

	// 次の更新チェック処理へ
	// 呼び出し元: checkUpdates, _checkUpdatesNext, HTTPRequest._timerCallback
	_checkUpdatesNext: function F2S__checkUpdatesNext() {
		// LOG("_checkUpdatesNext ", true);	// #debug
		// 完了したリクエストを配列から削除する
		for (var i = 0; i < this._checkUpdatesRequests.length; i++) {
			var request = this._checkUpdatesRequests[i];
			// LOG(" [" + i + "] " + (request.active ? "o" : "x") + " " + request.itemId);	// #debug
			if (!request.active) {
				request.destroy();
				this._checkUpdatesRequests.splice(i, 1);
			}
		}
		// リクエストがいっぱいの場合、何もせず待つ
		var maxConn = FoxAge2chUtils.prefs.getIntPref("maxConnections");
		maxConn = Math.max(Math.min(maxConn, 4), 1);
		if (this._checkUpdatesRequests.length >= maxConn) {
			CommandStateManager.update("cmd_checkUpdates", false);
			return;
		}
		// キューに何も無い場合、終了
		var itemId = this._checkUpdatesQueue.shift();
		if (!itemId) {
			CommandStateManager.update("cmd_checkUpdates", true);
			if (this._checkUpdatesRequests.length == 0) {
				// 更新チェック中のツリーアイテムのアイコンにAPNGを使用している場合、
				// すべての更新チェックが終了した後でもCPU使用率が上昇したままとなる問題への対策として、
				// ツリーのnsITreeBoxObject::clearStyleAndImageCachesを呼び出して描画のキャッシュを削除する。
				FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "finish-checking");
				// 板のエラー数を更新する
				this._updateRootStats();
			}
			return;
		}
		// アイテムが存在しないか板ではない場合、すぐに次のキューへ
		var boardItem = this.getItem(itemId);
		if (!boardItem || boardItem.type != FoxAge2chUtils.TYPE_BOARD) {
			this._checkUpdatesNext();
			return;
		}
		// ストレージとの同期
		switch (FoxAge2chUtils.bbs2chVersion) {
			// [bbs2ch-0.4]
			case FoxAge2chUtils.B2R_VER_04: break;
			// [bbs2ch-0.5]
			case FoxAge2chUtils.B2R_VER_05: this._syncWithBbs2chStorage(boardItem); break;
			// [chaika]
			case FoxAge2chUtils.B2R_CHAIKA: this._syncWithChaikaStorage(boardItem); break;
		}
		// チェック中ステータスの追加
		this._addStatusFlag(boardItem, FoxAge2chUtils.STATUS_CHECKING);
		FoxAge2chUtils.rebuildTree(boardItem.id);
		FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("CHECKING") + ": " + boardItem.title + "...");
		// 末尾に...を付けてメッセージの自動消去を抑止する @see FoxAge2chUI.observe
		var loadCallback = function(aResponseText) {
			var item = this.owner.getItem(this.itemId);
			if (item) {
				this.owner._removeStatusFlag(item, FoxAge2chUtils.STATUS_ERROR);
				this.owner._removeStatusFlag(item, FoxAge2chUtils.STATUS_CHECKING);
				this.owner._manipulateDataWithSubjectTxt(item, aResponseText);
				if (FoxAge2chUtils.prefs.getBoolPref("loadAfterChecking"))
					this.owner.openUpdates(item.id);
			}
			else FoxAge2chUtils.reportError("item is already deleted: " + this.itemId);	// #debug
		};
		var errorCallback = function(aStatus) {
			var item = this.owner.getItem(this.itemId);
			FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("ERROR") + " (" + aStatus + ")");
			if (item) {
				this.owner._removeStatusFlag(item, FoxAge2chUtils.STATUS_CHECKING);
				if (aStatus != 0)
					// ソケットエラーの場合は板移転とみなさない
					this.owner._addStatusFlag(item, FoxAge2chUtils.STATUS_ERROR);
			}
			else FoxAge2chUtils.reportError("item is already deleted: " + this.itemId);	// #debug
		};
		var timerCallback = function() {
			var item = this.owner.getItem(this.itemId);
			if (item) {
				this.owner._removeStatusFlag(item, FoxAge2chUtils.STATUS_CHECKING);
				FoxAge2chUtils.rebuildTree(item.id);
			}
			else FoxAge2chUtils.reportError("item is already deleted: " + this.itemId);	// #debug
			this.owner._checkUpdatesNext();
		};
		// 要求インスタンス生成と参照の追加
		var request = FoxAge2chUtils.createHTTPRequest();
		request.itemId = boardItem.id;
		request.owner = this;
		this._checkUpdatesRequests.push(request);
		// 前回チェック日時との比較
		const LOCK_TIME = 60;
		var newDate = Math.floor(new Date() / 1000);
		var diffTime = newDate - boardItem.checkDate;
		if (diffTime < LOCK_TIME) {
			FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("BUSY_WAIT_SECONDS", [LOCK_TIME - diffTime]));
			// HTTP接続せずにタイマーだけ作動
			request.setTimeout(timerCallback);
		}
		else {
			// 最終チェック日時更新
			// [TODO] ここではなくloadCallbackにて更新すべきかも
			this.changeItemProperty(boardItem, "checkDate", newDate);
			// HTTP接続開始して完了後にタイマー動作
			var url = FoxAge2chUtils.parseToURL(boardItem) + "subject.txt";
			request.send(url, loadCallback, errorCallback, timerCallback);
		}
	},

	// [bbs2ch-0.5] storage.sqliteの既読レス数を取得し、
	// FoxAge2chの既読レス数よりも大きい場合はFoxAge2chの既読レス数・総レス数を更新する。
	// @param aBoardItem 板のアイテム
	_syncWithBbs2chStorage: function F2S__syncWithBbs2chStorage(aBoardItem) {
		if (this._b2rStorage === undefined)
			this._b2rStorage = Cc["@bbs2ch.sourceforge.jp/b2r-storage-service;1"].
			                   getService(Ci.b2rIStorageService);
		var boardURL = Cc['@mozilla.org/network/standard-url;1'].createInstance(Ci.nsIURL);
		boardURL.spec = FoxAge2chUtils.parseToURL(aBoardItem);
		var b2rBoard = Cc["@bbs2ch.sourceforge.jp/b2r-board;1"].createInstance(Ci.b2rIBoard);
		b2rBoard.init(boardURL);
		var shouldRebuild = false;
		this.getChildItems(aBoardItem.id, {}).forEach(function(threadItem) {
			var dat = FoxAge2chUtils.threadKeyOfItem(threadItem);
			var b2rThread = this._b2rStorage.getThreadData(b2rBoard, dat);
			var b2rReadRes = b2rThread ? b2rThread.lineCount : 0;
			if (threadItem.readRes < b2rReadRes) {
				// #debug-begin
				var msg = "sync with bbs2ch storage: " + threadItem.readRes + " > " + b2rReadRes + "\t" + threadItem.title;
				FoxAge2chUtils.fuelApp.console.log(msg);
				// #debug-end
				this.changeItemProperty(threadItem, "readRes", b2rReadRes);
				this.changeItemProperty(threadItem, "lastRes", b2rReadRes);
				if (threadItem.readRes >= threadItem.lastRes)
					this._removeStatusFlag(threadItem, FoxAge2chUtils.STATUS_UPDATED);
				shouldRebuild = true;
			}
		}, this);
		if (shouldRebuild) {
			// 板のプロパティを更新
			this._updateBoardStats(aBoardItem);
			FoxAge2chUtils.rebuildTree();
		}
	},

	// [chaika] storage.sqliteの既読レス数を取得し、
	// FoxAge2chの既読レス数よりも大きい場合はFoxAge2chの既読レス数・総レス数を更新する。
	// @param aBoardItem 板のアイテム
	_syncWithChaikaStorage: function F2S__syncWithChaikaStorage(aBoardItem) {
		var shouldRebuild = false;
		this.getChildItems(aBoardItem.id, {}).forEach(function(threadItem) {
			var threadURL = FoxAge2chUtils.parseToURL(threadItem, false);
			var lineCount = FoxAge2chUtils.chaikaService.getThreadLineCount(FoxAge2chUtils.makeURI(threadURL));
			if (threadItem.readRes < lineCount) {
				// #debug-begin
				var msg = "sync with chaika storage: " + threadItem.readRes + " > " + lineCount + "\t" + threadItem.title;
				FoxAge2chUtils.fuelApp.console.log(msg);
				// #debug-end
				this.changeItemProperty(threadItem, "readRes", lineCount);
				this.changeItemProperty(threadItem, "lastRes", lineCount);
				if (threadItem.readRes >= threadItem.lastRes)
					this._removeStatusFlag(threadItem, FoxAge2chUtils.STATUS_UPDATED);
				shouldRebuild = true;
			}
		}, this);
		if (shouldRebuild) {
			// 板のプロパティを更新
			this._updateBoardStats(aBoardItem);
			FoxAge2chUtils.rebuildTree();
		}
	},

	////////////////////////////////////////////////////////////////////////////////
	// タイトル取得

	// タイトル取得用のHTTPRequestオブジェクト
	_fetchTitleRequest: null,

	// タイトル取得処理待ちのアイテムIDの配列
	_fetchTitleQueue: [],

	// タイトル取得
	fetchTitle: function F2S_fetchTitle(aItem) {
		if (this._fetchTitleRequest) {
			// タイトル取得処理中ならキューに入れて待つ（ただし同一アイテムIDを二重に追加しない）
			if (this._fetchTitleQueue.indexOf(aItem.id) < 0)
				this._fetchTitleQueue.push(aItem.id);
			return;
		}
		var url = FoxAge2chUtils.parseToURL(aItem);
		// 2ch BBSの場合、READJSモードだとread.cgiやread.htmlでタイトル取得できないのでread.soに変更。
		// 副作用としてread.soに対応していない一部の板でタイトル取得できなくなる。
		// 例: 運用情報（超臨時） http://sports2.2ch.net/operatex/
		// READJSモードであるかどうかはサイト"2ch.net"のCookie"READJS"の値が"on"であるかどうかで判別可能。
		if (url.indexOf(".2ch.net") > 0)
			url = url.replace(/\/read\.(?:cgi|html)\//, "/read.so/");
		// スレの場合はレス1のみ取得すれば十分
		if (aItem.type == FoxAge2chUtils.TYPE_THREAD)
			url += "1";
		// 末尾に...を付けてメッセージの自動消去を抑止する @see FoxAge2chUI.observe
		FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("GET_TITLE") + "...");
		var loadCallback = function(aResponseText) {
			var item = this.owner.getItem(this.itemId);
			if (item) {
				// ニコニコ動画掲示板のみ<h1>タグからタイトル取得
				var pattern = item.id.indexOf("bbs.nicovideo.jp") == 0
				            ? /<h1>([^<]+)<\/h1>/i : /<title>([^<]+)<\/title>/i;
				if (pattern.test(aResponseText)) {
					var title = RegExp.$1;
					title = FoxAge2chUtils.unescapeEntities(title);
					title = FoxAge2chUtils.sanitizeTitle(title);
					if (item.type == FoxAge2chUtils.TYPE_BOARD)
						// 「＠2ch掲示板」「＠bbspink掲示板」などをカット
						title = title.replace(/\uFF20.+$/, "");
					FoxAge2chUtils.service.changeItemProperty(item, "title", title);
					FoxAge2chUtils.rebuildTree(item.id);
					FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("SUCCESS"));
				}
				else FoxAge2chUtils.reportError("title is not found:\n" + aResponseText);	// #debug
			}
			else FoxAge2chUtils.reportError("item is already deleted: " + this.itemId);	// #debug
			// 次のタイトル取得
			this.owner._fetchTitleNext();
		};
		var errorCallback = function(aStatus) {
			var item = this.owner.getItem(this.itemId);
			if (item.type == FoxAge2chUtils.TYPE_THREAD) {
				// スレッドのタイトル取得失敗時、subject.txtからタイトル取得
				this.owner._fetchTitleFromSubjectTxt(item);
			}
			else {
				FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("ERROR") + " (" + aStatus + ")");
				// 次のタイトル取得
				this.owner._fetchTitleNext();
			}
		};
		this._fetchTitleRequest = FoxAge2chUtils.createHTTPRequest();
		this._fetchTitleRequest.itemId = aItem.id;
		this._fetchTitleRequest.owner = this;
		this._fetchTitleRequest.send(url, loadCallback, errorCallback);
	},

	// subject.txtからタイトルを取得する
	// fetchTitleでスレッドのタイトル取得失敗時に呼び出される
	// _fetchTitleQueueのキューに関係なく、最優先で処理を実行する。
	_fetchTitleFromSubjectTxt: function F2S__fetchTitleFromSubjectTxt(aItem) {
		FoxAge2chUtils.reportError(arguments.callee.name + " (" + aItem.id + ")");	// #debug
		var url = FoxAge2chUtils.parseToURL(this.getItem(aItem.parent)) + "subject.txt";
		// 末尾に...を付けてメッセージの自動消去を抑止する @see FoxAge2chUI.observe
		FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("GET_TITLE") + " (subject.txt)...");
		var loadCallback = function(aResponseText) {
			var item = this.owner.getItem(this.itemId);
			if (item) {
				// @see findThread.js FindThread.init
				// 1213352492.dat<>Mozilla Firefox Part85 (39) → %key%.dat<>%title% (nn)
				// 1212650212.cgi,ぷよぷよシリーズ！(72)       → %key%.cgi,%title%(nn)
				var dat = FoxAge2chUtils.threadKeyOfItem(item);
				var pattern = new RegExp(dat + "\\.(?:dat<>|cgi,)(.+)\\s*\\(\\d+\\)");
				if (pattern.test(aResponseText)) {
					var title = RegExp.$1;
					title = FoxAge2chUtils.unescapeEntities(title);
					title = FoxAge2chUtils.sanitizeTitle(title);
					FoxAge2chUtils.service.changeItemProperty(item, "title", title);
					FoxAge2chUtils.rebuildTree(item.id);
					FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("SUCCESS"));
				}
				// else FoxAge2chUtils.reportError("title is not found in subject.txt:\n" + aResponseText);	// #debug
			}
			else FoxAge2chUtils.reportError("item is already deleted: " + this.itemId);	// #debug
			// 次のタイトル取得
			this.owner._fetchTitleNext();
		};
		var errorCallback = function(aStatus) {
			FoxAge2chUtils.showMessage(FoxAge2chUtils.getLocaleString("ERROR") + " (" + aStatus + ")");
			// 次のタイトル取得
			this.owner._fetchTitleNext();
		};
		this._fetchTitleRequest = FoxAge2chUtils.createHTTPRequest();
		this._fetchTitleRequest.itemId = aItem.id;
		this._fetchTitleRequest.owner = this;
		this._fetchTitleRequest.send(url, loadCallback, errorCallback);
	},

	_fetchTitleNext: function F2S__fetchTitleNext() {
		this._fetchTitleRequest = null;
		if (this._fetchTitleQueue.length == 0)
			return;
		FoxAge2chUtils.reportError(arguments.callee.name + "\n" + this._fetchTitleQueue.join("\n"));	// #debug
		var item = this.getItem(this._fetchTitleQueue.shift());
		if (item)
			this.fetchTitle(item);
	},

	////////////////////////////////////////////////////////////////////////////////
	// その他各種機能

	// 更新されたスレッドを開く
	openUpdates: function F2S_openUpdates(aItemId) {
		if (!aItemId)
			ThreadLoader.stop();
		else
			ThreadLoader.append(aItemId);
	},

	// 指定したURLに対応する板またはスレッドを登録する
	addFavorite: function F2S_addFavorite(aURL) {
		var newItem = null;
		try {
			var [boardId, threadId] = FoxAge2chUtils.parseFromURL(aURL);
			if (boardId && threadId) {
				// スレッドを追加
				var boardItem = this.getItem(boardId);
				if (!boardItem) {
					// 板も追加
					boardItem = FoxAge2chUtils.createBoardItem(boardId);
					this.insertItem(boardItem, null);
					this.fetchTitle(boardItem);
				}
				newItem = FoxAge2chUtils.createThreadItem(threadId, boardItem);
				this.insertItem(newItem, null);
				this.fetchTitle(newItem);
			}
			else if (boardId) {
				// 板を追加
				newItem = FoxAge2chUtils.createBoardItem(boardId);
				this.insertItem(newItem, null);
				this.fetchTitle(newItem);
			}
		}
		catch (ex) {
			if (ex.result) Components.utils.reportError(ex);	// #debug
			var msg = "";
			if (ex == Cr.NS_ERROR_INVALID_ARG || ex == Cr.NS_ERROR_MALFORMED_URI)
				// FoxAge2chUtils.parseFromURL でスローされた例外
				msg = FoxAge2chUtils.getLocaleString("INVALID_URL") + ":\n" + aURL;
			else if (ex == Cr.NS_ERROR_ABORT)
				// this.insertItem でスローされた例外
				msg = FoxAge2chUtils.getLocaleString("ALREADY_ADDED") + ":\n" + aURL;
			else
				msg = FoxAge2chUtils.getLocaleString("ERROR_UNKNOWN") + ":\n" + ex;
			FoxAge2chUtils.alert(msg);
			return null;
		}
		return newItem;
	},

	// コマンドの有効／無効状態を返す
	isCommandEnabled: function F2S_isCommandEnabled(aCommand) {
		FoxAge2chUtils.assert(aCommand in CommandStateManager, "unknown command");	// #debug
		return CommandStateManager[aCommand];
	},

	// HTTPRequestを使用するすべての処理（更新チェックとタイトル取得）を停止する
	_cancelAllRequests: function F2S__cancelAllRequests() {
		// 更新チェック中止（必ず配列の末尾から処理すること）
		for (var i = this._checkUpdatesRequests.length - 1; i >= 0; i--) {
			var request = this._checkUpdatesRequests[i];
			// 更新チェック中ステータスを解除
			var item = this.getItem(request.itemId);
			if (item)
				this._removeStatusFlag(item, FoxAge2chUtils.STATUS_CHECKING);
			request.destroy();
			// 配列から削除
			this._checkUpdatesRequests.splice(i, 1);
		}
		this._checkUpdatesQueue = [];
		this._checkUpdatesRequests = [];
		// タイトル取得中止
		if (this._fetchTitleRequest) {
			this._fetchTitleRequest.destroy();
			this._fetchTitleRequest = null;
			this._fetchTitleQueue = [];
		}
		// 「チェック中」の通知を消去する
		FoxAge2chUtils.showMessage(null);
		CommandStateManager.update("cmd_checkUpdates", true);
	},

	////////////////////////////////////////////////////////////////////////////////
	// nsIObserver

	observe: function F2S_observe(aSubject, aTopic, aData) {
		// LOG("FoxAge2chService.observe(" + Array.prototype.slice.call(arguments).join(", ") + ")");	// #debug
		switch (aTopic) {
			case "timer-callback": 
				this._flushTimer = null;
				this._flushData();
				break;
			case "quit-application": 
				this._destroy();
				break;
			case "nsPref:changed": 
				switch (aData.substr(PREF_DOMAIN.length)) {
					case "dataDir.default": 
					case "dataDir.path": 
						// データ保存先変更時、データ再読み込み後にオブザーバへ通知してサイドバーを開きなおす
						this.reloadData();
						break;
					case "tree.viewMode": 
						// 表示モード設定変更時、オブザーバへ通知してサイドバーを開きなおす
						FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "reload-data");
						break;
					case "autoCheckInterval": 
						// 自動更新チェック設定変更時、タイマーを再セットする
						AutoCheck.init();
						break;
				}
				break;
		}
	}

};


////////////////////////////////////////////////////////////////////////////////
// 更新されたスレッドを開く処理を行うオブジェクト

var ThreadLoader = {

	// 「更新されたスレッドを開く」処理待ちのアイテムIDの配列
	// 「すべての板の更新チェック」では以下のように配列が展開されながら処理される。
	// (1) [ルート] 初回のappendでルートが配列へ追加される
	// (2) [板1, 板2, 板3] _nextでルートを親とするすべての板が配列へ追加される
	// (3) [スレ1-1, スレ1-2, 板2, 板3] _nextで板1を親とするすべての更新されたスレッドが配列の先頭へ挿入される
	// (4) [スレ1-2, 板2, 板3] _nextで先頭のスレが開く処理に渡される
	// (5) [板2, 板3] _nextで先頭のスレが開く処理に渡される
	// (6) [板3] _nextで板2を親とするすべての更新されたスレッドが配列の先頭へ挿入される。一つも無い場合は_nextする。
	// (7) [] _nextで板2を親とするすべての更新されたスレッドが配列の先頭へ挿入される。一つも無い場合は_nextして終了。
	_queue: [],

	_timer: null,

	// タイマー動作中であればtrueを返す
	get busy() {
		return !!this._timer;
	},

	append: function TL_append(aItemId) {
		this._queue.push(aItemId);
		if (this.busy)
			// キューに入れたままで待つ
			return;
		this._next();
	},

	_next: function TL__next() {
		CommandStateManager.update("cmd_openUpdates", false);
		// キューから先頭のアイテムを取り出す
		var itemId = this._queue.shift();
		if (!itemId) {
			this._timer = null;
			CommandStateManager.update("cmd_openUpdates", true);
			return;
		}
		var item = FoxAge2chUtils.service.getItem(itemId);
		if (!item) {
			// itemが存在しなければすぐに次のキューへ
			this._next();
		}
		else if (item.id == "root" || item.type == FoxAge2chUtils.TYPE_BOARD) {
			// ルートなら子の全板、板なら子の更新された全スレッドへと展開する
			FoxAge2chUtils.service.getChildItems(itemId, {})
			.filter(function(aItem) {
				if (aItem.type == FoxAge2chUtils.TYPE_BOARD)
					return true;
				if ((aItem.type == FoxAge2chUtils.TYPE_THREAD) && 
				    (aItem.status & FoxAge2chUtils.STATUS_UPDATED))
					return true;
				return false;
			})
			// 抽出したアイテムをキューの先頭へ追加する
			.reverse().forEach(function(aItem) {
				this._queue.splice(0, 0, aItem.id);
			}, this);
			// すぐに次のキューへ
			this._next();
		}
		else if (item.type == FoxAge2chUtils.TYPE_THREAD) {
			// スレッドならバックグラウンドの新しいタブで開く
			if (!(item.status & FoxAge2chUtils.STATUS_UPDATED)) {
				// 先行して手動で開いてステータスが既読になっている場合
				this._next();
				return;
			}
			FoxAge2chUtils.service.openItem(item, true, true);
			if (this._queue.length == 0) {
				// 最後のスレッドを開いた後はすぐに次のキューへ移って終了する
				// XXX この後に更新されたスレが無い板がキューされている場合を除く
				this._next();
			}
			else {
				// 一時停止後、次のキューへ
				var delay = FoxAge2chUtils.prefs.getIntPref("loadInterval");
				delay = Math.max(delay, 1) * 1000;
				this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
				this._timer.initWithCallback(this, delay, Ci.nsITimer.TYPE_ONE_SHOT);
			}
		}
		else FoxAge2chUtils.assert(false, "unexpected");	// #debug
	},

	notify: function TL_notify(aTimer) {
		this._next();
	},

	stop: function TL_stop() {
		this._queue = [];
		if (this._timer) {
			this._timer.cancel();
			this._timer = null;
		}
		CommandStateManager.update("cmd_openUpdates", true);
	}

};


////////////////////////////////////////////////////////////////////////////////
// コマンドの有効／無効状態を管理するオブジェクト

var CommandStateManager = {

	cmd_checkUpdates: true,
	cmd_openUpdates : true,

	// 「更新チェック」「更新されたスレッドを開く」のいずれかのコマンドの有効／無効状態に
	// 変化があった場合、TOPIC_GLOBAL/command-updateでオブザーバへの通知を行う。
	// コマンドの有効／無効状態の変化がありそうな箇所でとりあえず呼び出しておけばよい。
	update: function CM_update(aCommand, aEnabled) {
		var shouldNotify = false;
		if (this[aCommand] !== aEnabled) {
			this[aCommand] = aEnabled;
			shouldNotify = true;
			LOG("CommandStateManager(" + aCommand + ", " + aEnabled + ")");	// #debug
		}
		if (shouldNotify)
			FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "command-update");
	}

};


////////////////////////////////////////////////////////////////////////////////
// 自動更新チェック機能を管理するオブジェクト

var AutoCheck = {

	_timer: null,

	// 自動更新チェックのタイマー開始
	init: function AC_init() {
		this.uninit();
		var interval = FoxAge2chUtils.prefs.getIntPref("autoCheckInterval");
		if (interval > 0) {
			this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
			this._timer.initWithCallback(this, interval * 1000 * 60, Ci.nsITimer.TYPE_REPEATING_SLACK);
		}
	},

	// 自動更新チェックのタイマー終了
	uninit: function AC_uninit() {
		if (this._timer) {
			this._timer.cancel();
			this._timer = null;
		}
	},

	notify: function AC_notify(aTimer) {
		FoxAge2chUtils.observer.notifyObservers(null, FoxAge2chUtils.TOPIC_GLOBAL, "auto-check");
	}

};


////////////////////////////////////////////////////////////////////////////////
// XPCOM サービス登録

var NSGetFactory = XPCOMUtils.generateNSGetFactory([FoxAge2chService]);


