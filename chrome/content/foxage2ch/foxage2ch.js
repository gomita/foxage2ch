////////////////////////////////////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://foxage2ch/utils.jsm");
const FoxAge2chService = FoxAge2chUtils.service;


////////////////////////////////////////////////////////////////////////////////
// FoxAge2chUI

var FoxAge2chUI = {

	get windowMediator() {
		delete this.windowMediator;
		return this.windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
		                             getService(Ci.nsIWindowMediator);
	},

	// [xpconnect wrapped (nsISupports, nsITreeView, xdIFoxAge2chTreeView)]
	mainView: null,

	// [xpconnect wrapped (nsISupports, nsITreeView, xdIFoxAge2chTreeView)]
	subView: null,

	viewMode: 0,

	// #foxage2chWindow@onload
	init: function F2_init() {
		var mainTree = document.getElementById("mainTree");
		var viewMode = FoxAge2chUtils.prefs.getIntPref("tree.viewMode");
		if (viewMode == 3) {
			// 自動判別
			var width, height;
			if (window.innerHeight == 0) {
				// ウィンドウで開いた場合にinnerHeightが0となるための代替手段
				var elt = document.documentElement;
				width  = parseInt(elt.getAttribute("width"));
				height = parseInt(elt.getAttribute("height"));
			}
			else {
				width = window.innerWidth, height = window.innerHeight;
			}
			viewMode = width < height ? 1 : 2;
		}
		this.viewMode = viewMode;
		if (viewMode == 0) {
			// 通常ツリー表示モード
			mainTree.view = new FoxAge2chTreeView("both", "root", true);
			mainTree.controllers.appendController(FoxAge2chController);
			this.mainView = mainTree.view.QueryInterface(Ci.xdIFoxAge2chTreeView);
		}
		else {
			// 2ペイン表示モード
			document.getElementById("viewSplitter").hidden = false;
			document.getElementById("subTreeOuter").hidden = false;
			document.getElementById("toggleFoldersButton").hidden = true;
			mainTree.view = new FoxAge2chTreeView("boards", "root", false);
			mainTree.parentNode.orient = (viewMode == 2) ? "horizontal" : "vertical";
			mainTree.controllers.appendController(FoxAge2chController);
			this.mainView = mainTree.view.QueryInterface(Ci.xdIFoxAge2chTreeView);
			var subTree = document.getElementById("subTree");
			subTree.view = new FoxAge2chTreeView("threads", null, false);
			subTree.controllers.appendController(FoxAge2chController);
			this.subView = subTree.view.QueryInterface(Ci.xdIFoxAge2chTreeView);
			// 最後に選択した板を表示 (rootがnullなら非表示)
			var boardId = subTree.getAttribute("root");
			var boardItem = FoxAge2chService.getItem(boardId);
			this.showSubPane(boardItem);
			if (boardItem)
				this.mainView.selectIndex(this.mainView.treeIndexForItem(boardItem));
			// 横型2ペインのメインツリー幅の初期値をセット
			if (viewMode == 2 && !mainTree.hasAttribute("width"))
				mainTree.setAttribute("width", "200");
		}
		// ウィンドウで開いた場合のみCtrl+Wを有効にする
		// サイドバー・タブで開いた場合は無効にし、デフォルトの動作（タブを閉じる）を有効にする
		var win = this.windowMediator.getMostRecentWindow("FoxAge2ch");
		if (win == window)
			document.getElementById("key_closeWindow").removeAttribute("disabled");
		FoxAge2chUtils.observer.addObserver(this, FoxAge2chUtils.TOPIC_SHOW_MESSAGE, false);
		FoxAge2chUtils.observer.addObserver(this, FoxAge2chUtils.TOPIC_REBUILD_TREE, false);
		FoxAge2chUtils.observer.addObserver(this, FoxAge2chUtils.TOPIC_GLOBAL, false);
		this.updateToolbarState();
		this.updateErrorMessage();
		mainTree.focus();
		this._initFlag = 1;
		if (FoxAge2chUtils.prefs.getBoolPref("autoCheckOnStartup"))
			FoxAge2chService.checkUpdates("root");
		document.documentElement.setAttribute("platform", navigator.platform);
		document.documentElement.setAttribute("oscpu", navigator.oscpu);
		// [Windows][Linux] タブで開いた場合、特別なスタイルを追加
		if (navigator.platform.indexOf("Mac") != 0) {
			var win = this.windowMediator.getMostRecentWindow("navigator:browser");
			var tab = win.gBrowser._getTabForContentWindow(window);
			if (tab) {
				document.getElementById("inContentCSS").setAttribute("media", "all");
				document.documentElement.style.padding = "0px";
			}
		}
	},

	// #foxage2chWindow@onbeforeunload  サイドバーで開いた場合のみ呼ばれる
	// #foxage2chWindow@onclose         ウィンドウで開いた場合のみ呼ばれる
	// #foxage2chWindow@onunload        サイドバー／ウィンドウによらず必ず呼ばれる
	// 注意: onunloadだけだとremoveObserverするよりも前にtreeBoxObjectが消滅し、
	// 更新チェック中にサイドバーを閉じると微妙なタイミングの差によってrebuildTreeの
	// エラーが発生するため、onbeforeunloadやoncloseでuninitする必要がある。
	uninit: function F2_uninit() {
		if (this._initFlag != 1)
			return;
		this._initFlag = 2;
		FoxAge2chService.checkUpdates(null);
		FoxAge2chUtils.observer.removeObserver(this, FoxAge2chUtils.TOPIC_SHOW_MESSAGE);
		FoxAge2chUtils.observer.removeObserver(this, FoxAge2chUtils.TOPIC_REBUILD_TREE);
		FoxAge2chUtils.observer.removeObserver(this, FoxAge2chUtils.TOPIC_GLOBAL);
		this.mainView.root = null;
		this.mainView = null;
		var mainTree = document.getElementById("mainTree");
		mainTree.view = null;
		mainTree.controllers.removeController(FoxAge2chController);
		if (this.subView) {
			// 2ペイン表示モード
			this.subView.root = null;
			this.subView = null;
			var subTree = document.getElementById("subTree");
			subTree.view = null;
			subTree.controllers.removeController(FoxAge2chController);
		}
		if (this._notificationTimer) {
			window.clearTimeout(this._notificationTimer);
			this._notificationTimer = null;
		}
		if (this._notificationBox) {
			this._notificationBox.removeAllNotifications();
			this._notificationBox = null;
		}
		this.windowMediator = null;
	},

	// 1: init完了
	// 2: uninit開始
	_initFlag: 0,

	// @param String aBoardId サブペインに表示する板のアイテム。nullならサブペインを非表示にする。
	showSubPane: function F2_showSubPane(aBoardItem) {
		// xul:tree に対して hidden = true や style.display = "none" すると
		// nsITreeView#setTree(null) が呼び出されてしまうので collapsed を使用すること。
		document.getElementById("viewSplitter").collapsed = !aBoardItem;
		document.getElementById("subTreeOuter").collapsed = !aBoardItem;
		this.subView.root = aBoardItem ? aBoardItem.id : null;
		this.subView.selection.select(-1);
		if (aBoardItem) {
			// 表示
			document.getElementById("subTreeHeader").value = aBoardItem.title;
			document.getElementById("subTree").setAttribute("root", aBoardItem.id);
			if (this.viewMode == 2)
				document.getElementById("mainTree").removeAttribute("flex");
		}
		else {
			// 非表示
			document.getElementById("subTree").removeAttribute("root");
			this.mainView.selection.clearSelection();
			if (this.viewMode == 2)
				document.getElementById("mainTree").setAttribute("flex", "1");
		}
	},

	// メッセージを表示する
	// @param String aLabel 表示するメッセージ。nullならメッセージを消去する。
	// @prama String aValue メッセージのID。同一IDなら既存のメッセージを上書きする。
	//                      通常のメッセージは"default"。エラー通知メッセージは"boardError", "threadError"。
	// @param Number aMillisec 指定したミリ秒後にメッセージを消去する。デフォルト3秒。-1なら消去しない。
	showMessage: function F2_showMessage(aLabel, aValue, aMillisec) {
		if (!this._notificationBox)
			this._notificationBox = document.getElementById("foxage2chNotifbox");
		var notif = this._notificationBox.getNotificationWithValue(aValue);
		if (!aLabel) {
			if (notif)
				this._notificationBox.removeNotification(notif);
			return;
		}
		if (notif)
			// 現在のnotificationを再利用
			notif.label = aLabel;
		else {
			// 新規のnotificationを追加
			// 注意: 表示優先度の値を変更する際は、foxage2ch.cssのスタイルも修正すること。
			var priority = (aValue == "default") 
			             ? this._notificationBox.PRIORITY_WARNING_HIGH
			             : this._notificationBox.PRIORITY_WARNING_LOW;
			this._notificationBox.appendNotification(aLabel, aValue, null, priority, null);
		}
		if (aMillisec < 0)
			return;
		if (this._notificationTimer) {
			window.clearTimeout(this._notificationTimer);
			this._notificationTimer = null;
		}
		var callback = function(self) {
			self._notificationTimer = null;
			var notif = self._notificationBox.getNotificationWithValue(aValue);
			if (notif && notif.label == aLabel)
				self._notificationBox.removeNotification(notif);
		};
		this._notificationTimer = window.setTimeout(callback, aMillisec || 3000, this);
	},
	_notificationBox: null,
	_notificationTimer: null,

	////////////////////////////////////////////////////////////////////////////////
	// event handlers

	// #mainTree@onclick
	// #subTree@onclick
	handleTreeClick: function F2_handleTreeClick(event) {
		if (event.target.localName != "treechildren")
			return;
		if (event.button != 0 && event.button != 1)
			return;
		var tree = event.currentTarget;
		// ヒットテスト
		var part = {};
		tree.treeBoxObject.getCellAt(event.clientX, event.clientY, {}, {}, part);
		if (!part.value || part.value == "twisty")
			return;
		var item = tree.view.currentItem;
		if (item.type == FoxAge2chUtils.TYPE_THREAD) {
			// スレをクリック: 開く
			// スレを中クリック: 新しいタブで開く
			this.openItemWithEvent(item, event);
		}
		else if (item.type == FoxAge2chUtils.TYPE_BOARD) {
			if (event.button == 1 || event.ctrlKey || event.shiftKey) {
				// 板を中クリック: タブで開く
				this.openItemWithEvent(item, event);
			}
			else {
				if (this.subView) {
					// 2ペイン表示モードで板をクリック: サブツリーを表示
					this.showSubPane(item);
				}
				else {
					// 通常ツリー表示モードで板をクリック: フォルダを開閉
					if (FoxAge2chUtils.prefs.getBoolPref("tree.autoCollapse")) {
						// 自動折り畳みモード有効時、いったんすべてのフォルダを閉じる。
						// その後、必要に応じて現在のフォルダのみ開く。
						var shouldOpen = !tree.view.isContainerOpen(tree.view.selection.currentIndex);
						tree.view.toggleAllFolders(true);
						if (!shouldOpen)
							return;
					}
					var idx = tree.view.selection.currentIndex;
					tree.view.toggleOpenState(idx);
					tree.treeBoxObject.ensureRowIsVisible(idx);
				}
			}
		}
		// 区切り: 何もしない
	},

	// #mainTree@onkeypress
	// #subTree@onkeypress
	handleTreeKeypress: function F2_handleTreeKeypress(event) {
		switch (event.keyCode) {
			case event.DOM_VK_RETURN: 
				var item = event.currentTarget.view.currentItem;
				if (item.type == FoxAge2chUtils.TYPE_THREAD)
					// スレッドなら開く
					this.openItemWithEvent(item, event);
				else if (item.type == FoxAge2chUtils.TYPE_BOARD && this.subView)
					// 2ペイン表示モードで板ならサブペインを表示する
					this.showSubPane(item);
				break;
			case event.DOM_VK_F2: 
				// プロパティ
				FoxAge2chController.doCommand("cmd_showInfo");
				break;
			case event.DOM_VK_DELETE: 
				// 削除
				event.preventDefault();
				FoxAge2chController.doCommand("cmd_delete");
				break;
			default: 
		}
	},

	// #subTreeHeader@onclick
	handleSubTreeHeaderClick: function F2_handleSubTreeHeaderClick(event) {
		var item = FoxAge2chService.getItem(this.subView.root);
		if (event.button == 1 || 
		    (event.button == 0 && (event.ctrlKey || event.shiftKey))) {
			// 板を新しいタブで開く
			this.openItemWithEvent(item, event);
		}
		else if (event.button == 0) {
			// ツリー上で板を選択
			var idx = this.mainView.treeIndexForItem(item);
			this.mainView.selectIndex(idx);
		}
	},

	// #foxage2chContext@onpopupshowing
	buildContextMenu: function F2_buildContextMenu(event) {
		if (document.popupNode.localName != "treechildren")
			// ツリーカラムヘッダ上での右クリックメニューを抑止
			return false;
		if (!document.popupNode.parentNode.view.currentItem)
			// ツリーアイテムが1つもない場合の右クリックメニューを抑止
			return false;
		document.commandDispatcher.updateCommands("contextmenu");
		var showNextSep = false;
		for (var i = 0; i < event.target.childNodes.length; i++) {
			var elt = event.target.childNodes[i];
			if (elt.nodeName == "menuseparator") {
				elt.hidden = !showNextSep;
				showNextSep = false;
				continue;
			}
			if (elt.command)
				elt.hidden = !FoxAge2chController.supportsCommand(elt.command);
			if (!elt.hidden)
				showNextSep = true;
		}
		return true;
	},

	// ツールバーボタンのチェック状態を更新する
	updateToolbarState: function F2_updateToolbarState() {
		var updateElement = function(aEltId, aChecked) {
			var elt = document.getElementById(aEltId);
			if (aChecked)
				elt.setAttribute("checked", "true");
			else
				elt.removeAttribute("checked");
		};
		updateElement("cmd_checkUpdatesAll", !FoxAge2chService.isCommandEnabled("cmd_checkUpdates"));
		updateElement("cmd_openUpdatesAll",  !FoxAge2chService.isCommandEnabled("cmd_openUpdates"));
	},

	// dat落ち通知メッセージを表示／非表示する
	updateErrorMessage: function F2_updateErrorMessage() {
		FoxAge2chUtils.trace();	// #debug
		var self = this;
		var showHideMessage = function(aName, aStrKey) {
			var error = FoxAge2chService.getItem("root")[aName];
			if (error > 0)
				self.showMessage(FoxAge2chUtils.getLocaleString(aStrKey, [error]), aName, -1);
			else
				self.showMessage(null, aName);
		};
		showHideMessage("threadError", "THREAD_ERROR");
		showHideMessage("boardError", "BOARD_ERROR");
		self = null;
	},

	// 引数aItemのスレッドまたは板を、引数eventで指定された形式のタブで開く
	// 引数aItemにstring型のURLを指定することも可能。
	openItemWithEvent: function F2_openItemWithEvent(aItem, event) {
		// 中クリック／Ctrl＋クリック／Shift＋クリック: 新しいタブで開く
		var inNewTab = FoxAge2chUtils.prefs.getBoolPref("openThreadInTab") || 
		               event.button == 1 || event.ctrlKey || event.shiftKey;
		var inBackground = null;
		if (inNewTab)
			// Shiftキー押下時、新しいタブをバックグラウンドで開くかどうかを逆にする
			inBackground = FoxAge2chUtils.prefs.getBoolPref("loadInBackground") ^ event.shiftKey;
		if (typeof(aItem) == "string")
			FoxAge2chUtils.loadURL(aItem, inNewTab, inBackground);
		else
			FoxAge2chService.openItem(aItem, inNewTab, inBackground);
	},

	// #mainTree > treechildren@{ondragstart|ondragenter|ondragover|ondrop}
	// #subTree  > treechildren@{ondragstart|ondragenter|ondragover|ondrop}
	handleTreeDNDEvent: function F2_handleTreeDNDEvent(event) {
		var dt = event.dataTransfer;
		switch (event.type) {
			case "dragstart": 
				var tree = event.target.parentNode;
				if (tree.view.selection.count != 1)
					return;
				var item = tree.view.currentItem;
				if (item.type != FoxAge2chUtils.TYPE_SEPARATOR) {
					// 板またはスレをドラッグ開始時、URLを転送
					var url = FoxAge2chUtils.parseToURL(item, true);
					dt.setData("text/x-moz-url", url + "\n" + item.title);
					dt.setData("text/unicode", url);
				}
				// ツリーからドラッグ開始時、ツリー行番号を転送
				var sourceIndex = tree.view.selection.currentIndex;
				dt.setData(FoxAge2chUtils.DROP_TYPE, sourceIndex);
				dt.dropEffect = "move";
				break;
			case "dragenter": 
			case "dragover": 
				// URL（リンクやfavicon）またはブラウザタブのドロップを許可
				if (dt.types.contains("text/x-moz-url") || 
				    dt.types.contains("application/x-moz-tabbrowser-tab"))
					event.preventDefault();
				break;
			case "drop": 
				event.preventDefault();
				if (dt.types.contains(FoxAge2chUtils.DROP_TYPE)) {
					// ツリーからツリーへのドロップ時、何もせずにFoxAge2chTreeView::drop側で処理
					return;
				}
				else if (dt.types.contains("text/x-moz-url")) {
					// URL（リンクやfavicon）のドロップ時、板やスレを追加
					var url = dt.getData("text/x-moz-url").split("\n")[0];
					this.addURL(url);
				}
				else if (dt.types.contains("application/x-moz-tabbrowser-tab")) {
					// ブラウザタブのドロップ時、板やスレを追加
					var url = dt.getData("text/x-moz-text-internal");
					this.addURL(url);
				}
				break;
			default: 
		}
	},

	////////////////////////////////////////////////////////////////////////////////
	// nsIObserver

	observe: function F2_observe(aSubject, aTopic, aData) {
		// FoxAge2chUtils.trace();	// #debug
		switch (aTopic) {
			case FoxAge2chUtils.TOPIC_SHOW_MESSAGE: 
				// ...が付く場合はメッセージを消去しない
				this.showMessage(aData, "default", aData && aData.lastIndexOf("...") > 0 ? -1 : 0);
				break;
			case FoxAge2chUtils.TOPIC_REBUILD_TREE: 
				if (aData) {
					// 特定のツリー行のみ再描画
					this.mainView.redrawItem(aData);
					if (this.subView && this.subView.root) {
						// サブペインが表示されている場合
						this.subView.redrawItem(aData);
						// XXX サブペインに表示された板のタイトルが変更された場合にヘッダの表示を更新
						// XXX 板のステータスなどが変更された場合でも冗長に表示が更新される問題あり
						if (this.subView.root == aData)
							document.getElementById("subTreeHeader").value = 
							FoxAge2chService.getItem(aData).title;
					}
				}
				else {
					// ツリー全体の再構築
					this.mainView.rebuildTree();
					if (this.subView && this.subView.root) {
						// サブペインが表示されている場合
						this.subView.rebuildTree();
						// XXX サブペインに表示された板が削除された場合にサブペインを閉じる
						if (!FoxAge2chService.getItem(this.subView.root))
							this.showSubPane(null);
					}
				}
				break;
			case FoxAge2chUtils.TOPIC_GLOBAL: 
				switch (aData) {
					case "reload-data": 
						window.setTimeout(function() { window.location.reload(); }, 0);
						break;
					case "command-update": 
						this.updateToolbarState();
						break;
					case "finish-checking": 
						this.mainView.clearDrawingCaches();
						break;
					case "auto-check": 
						if (FoxAge2chService.isCommandEnabled("cmd_checkUpdates"))
							FoxAge2chService.checkUpdates("root");
						break;
					case "error-notify": 
						this.updateErrorMessage();
						break;
					// #debug-begin
					default: 
						FoxAge2chUtils.reportError("unknown data with TOPIC_GLOBAL: " + aData);
					// #debug-end
				}
				break;
		}
	},

	////////////////////////////////////////////////////////////////////////////////
	// command hook

	// #searchFilter@oncommand
	onSearchFilterInput: function F2_onSearchFilterInput(aValue) {
		FoxAge2chUtils.trace();	// #debug
		// クイック検索移行前に現在のサブペインを記憶
		if (aValue && this.subView && !this._lastSubViewRoot)
			this._lastSubViewRoot = this.subView.root;
		// サブペインを閉じる
		if (this.subView)
			this.showSubPane(null);
		// フィルターをセット
		this.mainView.filter = this._makeFilter(aValue);
		this.mainView.selection.select(-1);
		// クイック検索終了後に以前のサブペインを復元
		if (!aValue && this.subView && this._lastSubViewRoot) {
			var boardItem = FoxAge2chService.getItem(this._lastSubViewRoot);
			this.showSubPane(boardItem);
			if (boardItem)
				this.mainView.selectIndex(this.mainView.treeIndexForItem(boardItem));
			this._lastSubViewRoot = null;
		}
	},

	// クイック検索フィールドへエラースレッド抽出用の文字列をセットして検索を実行する
	setFilter: function F2_setFilter(aValue) {
		var searchFilter = document.getElementById("searchFilter");
		searchFilter.value = aValue;
		searchFilter.doCommand();
	},

	_makeFilter: function F2__makeFilter(aValue) {
		if (!aValue)
			return null;
		var filter = { title: null, status: null, over1000: false, exclude: false };
		if (/^filter:([\w\|]+)\s*/.test(aValue)) {
			RegExp.$1.split("|").forEach(function(param) {
				switch (param) {
					case "updated": filter.status |= FoxAge2chUtils.STATUS_UPDATED; break;
					case "datout" : filter.status |= FoxAge2chUtils.STATUS_DATOUT; break;
					case "1000"   : filter.over1000 = true; break;
					case "exclude": filter.exclude = true; break;
				}
			});
			// 正しいフィルタ文字列のみ、フィルタ文字列右側をタイトル検索に用いる
			// 不正なフィルタ文字列(例:「filter:bozo」)はそのままタイトル検索する
			if (filter.status || filter.over1000 || filter.exclude)
				aValue = RegExp.rightContext;
		}
		filter.title = aValue.toLowerCase();
		// alert("\t" + filter.toSource());	// #debug
		return filter;
	},

	addURL: function F2_addURL(aURL) {
		if (!aURL) {
			var msg = FoxAge2chUtils.getLocaleString("ADD_URL");
			var win = this._getBrowserWindow();
			if (!win)
				return;
			var scheme = win.gBrowser.currentURI.scheme;
			var val = scheme == "chrome" || scheme == "about" ? "" : 
			          FoxAge2chUtils.unwrapURL(win.gBrowser.currentURI.spec);
			var ret = { value: val };
			if (!FoxAge2chUtils.prompt.prompt(window, "FoxAge2ch", msg, ret, null, {}))
				return;
			if (!ret.value)
				return;
			aURL = ret.value;
		}
		aURL = FoxAge2chUtils.unwrapURL(aURL);
		if (aURL.indexOf("ttp://") == 0)
			aURL = "h" + aURL;
		var newItem = FoxAge2chService.addFavorite(aURL);
		if (newItem)
			this.onItemAdded(newItem);
	},

	onItemAdded: function F2_onItemAdded(aNewItem) {
		if (aNewItem.type == FoxAge2chUtils.TYPE_THREAD) {
			var boardItem = FoxAge2chService.getItem(aNewItem.parent);
			// スレッド追加後のツリー操作
			if (this.subView) {
				// 2ペイン表示モード: サブペインを開いて板を選択する
				this.showSubPane(boardItem);
				this.mainView.selectIndex(this.mainView.treeIndexForItem(boardItem));
			}
			else {
				// 通常ツリー表示モード: 板のフォルダを開く
				var idx = this.mainView.treeIndexForItem(boardItem);
				// クイック検索モードではidxが-1となる
				if (idx >= 0 && !this.mainView.isContainerOpen(idx))
					this.mainView.toggleOpenState(idx);
			}
			// 追加したスレッドを選択する
			var view = this.subView || this.mainView;
			view.selectIndex(view.treeIndexForItem(aNewItem));
		}
		else if (aNewItem.type == FoxAge2chUtils.TYPE_BOARD)
			// 板追加後のツリー操作: 追加した板を選択する
			this.mainView.selectIndex(this.mainView.treeIndexForItem(aNewItem));
	},

	restoreFromBackup: function F2_restoreFromBackup(aMenuItem) {
		var backupDir = FoxAge2chUtils.dataDir;
		backupDir.append("backups");
		var filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		if (backupDir.exists())
			filePicker.displayDirectory = backupDir;
		filePicker.init(window, aMenuItem.getAttribute("label").replace("...", ""), filePicker.modeOpen);
		filePicker.appendFilter("JSON", "*.json");
		if (filePicker.show() == filePicker.returnOK) {
			// [TODO] 以下の処理はxdIFoxAge2chService側ですべき
			var oldFile = FoxAge2chUtils.dataDir;
			oldFile.append("foxage2ch.json");
			var newFile = filePicker.file;
			// 現在使用中のfoxage2ch.jsonを選択して復元するとファイル削除後にコピー失敗するバグへの対策
			if (!newFile.equals(oldFile)) {
				if (oldFile.exists())
					oldFile.remove(false);
				newFile.copyTo(FoxAge2chUtils.dataDir, "foxage2ch.json");
			}
			else FoxAge2chUtils.reportError("cannot restore from the current data file.");	// #debug
			FoxAge2chService.reloadData();
		}
	},

	openPreferences: function F2_openPreferences() {
		var win = this.windowMediator.getMostRecentWindow("FoxAge2ch:Options");
		if (win)
			return win.focus();
		var instantApply = Cc["@mozilla.org/preferences-service;1"].
		                   getService(Ci.nsIPrefBranch).
		                   getBoolPref("browser.preferences.instantApply", false);
		window.openDialog(
			"chrome://foxage2ch/content/options.xul", "FoxAge2ch:Options",
			"chrome,titlebar,toolbar,centerscreen," + (instantApply ? "dialog=no" : "modal")
		);
	},

	open2chBBS: function F2_open2chBBS(event) {
		if (event.button != 0 && event.button != 1)
			return;
		if (FoxAge2chUtils.bbs2chVersion) {
			// 直近のブラウザウィンドウでサイドバーを開く
			var win = this._getBrowserWindow();
			if (!win)
				return;
//			switch (FoxAge2chUtils.bbs2chVersion) {
//				case FoxAge2chUtils.B2R_VER_04: 
//				case FoxAge2chUtils.B2R_VER_05: 
//					// [bbs2ch-0.4][bbs2ch-0.5]
//					win.toggleSidebar("viewBbs2chSidebar", true);
//					break;
//					// [chaika]
//				case FoxAge2chUtils.B2R_CHAIKA: 
//					win.toggleSidebar("viewChaikaSidebar", true);
//					break;
//			}
			// [bbs2ch-0.4][bbs2ch-0.5][chaika-1.0.0a2][chaika-1.0.0a3] 互換維持のための暫定方式
			var sidebarId = win.document.getElementById("viewBbs2chSidebar")
			              ? "viewBbs2chSidebar" : "viewChaikaSidebar";
			win.toggleSidebar(sidebarId, true);
			win.focus();
		}
		else
			this.openItemWithEvent(FoxAge2chUtils.homePageURL, event);
		if (event.button == 1)
			event.target.parentNode.hidePopup();
	},

	// 直近のブラウザウィンドウのChromeWindowオブジェクトを返す。
	// FoxAge2chがウィンドウモードで開かれており、ブラウザウィンドウがひとつも開かれていない場合はnullを返す。
	_getBrowserWindow: function F2__getBrowserWindow() {
		var win = window.top;
		if (win.location.href == window.location.href)
			win = this.windowMediator.getMostRecentWindow("navigator:browser");
		return win;
	},

	findNextAll: function() {
		this.setFilter("filter:datout|1000 ");
		var view = document.getElementById("mainTree").view;
		if (view.rowCount == 0) {
			this.setFilter("");
			return;
		}
		var ids = [];
		for (var i = 0; i < view.rowCount; i++) {
			ids.push(view.itemForTreeIndex(i).id);
		}
		window.openDialog(
			"chrome://foxage2ch/content/findThread.xul", "FoxAge2ch:FindThread",
			"chrome,centerscreen,modal,dialog=no,all", ids.shift(), ids
		);
	},

};


////////////////////////////////////////////////////////////////////////////////
// FoxAge2chController

var FoxAge2chController = {

	////////////////////////////////////////////////////////////////////////////////
	// nsIController

	// FoxAge2chUI.buildContextMenuにて、各コマンドに対応したメニュー項目を
	// 表示するかどうかの判別用に使用する。
	supportsCommand: function F2_supportsCommand(aCommand) {
		var item = this.currentView.currentItem;
		// FoxAge2chUtils.trace();	// #debug
		if (!item)
			return false;
		var type = item.type;
		switch (aCommand) {
			case "cmd_open": 
			case "cmd_openNewTab": 
			case "cmd_fetchTitle": 
				return type == FoxAge2chUtils.TYPE_THREAD || type == FoxAge2chUtils.TYPE_BOARD;
			case "cmd_newSeparator": 
				return type == FoxAge2chUtils.TYPE_BOARD || type == FoxAge2chUtils.TYPE_SEPARATOR;
			case "cmd_checkUpdates": 
			case "cmd_openUpdates": 
			case "cmd_findThread": 
			case "cmd_transfer": 
				return type == FoxAge2chUtils.TYPE_BOARD;
			case "cmd_findNextThread": 
				return type == FoxAge2chUtils.TYPE_THREAD;
			case "cmd_checkUpdatesRange": 
			case "cmd_openUpdatesRange": 
				return type == FoxAge2chUtils.TYPE_SEPARATOR;
			case "cmd_checkUpdatesAll": 
			case "cmd_openUpdatesAll": 
			case "cmd_delete": 
			case "cmd_showInfo": 
				return true;
			// 注意: placesCmd_openなどについてもこのメソッドが呼び出されることがあるので、
			// 無関係なコマンドに対してfalseを返すようにする。
			default: 
				return false;
		}
	},

	isCommandEnabled: function F2_isCommandEnabled(aCommand) {
		// FoxAge2chUtils.trace();	// #debug
		switch (aCommand) {
			case "cmd_checkUpdates": 
			case "cmd_checkUpdatesRange": 
				return FoxAge2chService.isCommandEnabled("cmd_checkUpdates");
			case "cmd_openUpdates": 
			case "cmd_openUpdatesRange": 
				return FoxAge2chService.isCommandEnabled("cmd_openUpdates");
			// 注意: ツリーにフォーカスがある状態でメニューバーの「編集」メニューを開くと
			// isCommandEnabled("cmd_delete")が呼び出される。
			case "cmd_delete": 
				return true;
			// 注意: placesCmd_openなどについてもこのメソッドが呼び出されることがあるので、
			// 無関係なコマンドに対してfalseを返すようにする。
			default: 
				return false;
		}
	},

	doCommand: function F2_doCommand(aCommand) {
		switch (aCommand) {
			case "cmd_open": 
				FoxAge2chService.openItem(this.currentView.currentItem, false, null);
				break;
			case "cmd_openNewTab": 
				var inBackground = FoxAge2chUtils.prefs.getBoolPref("loadInBackground");
				FoxAge2chService.openItem(this.currentView.currentItem, true, inBackground);
				break;
			case "cmd_checkUpdates": 
				FoxAge2chService.checkUpdates(this.currentView.currentItem.id);
				break;
			case "cmd_checkUpdatesAll": 
				FoxAge2chService.checkUpdates(
					FoxAge2chService.isCommandEnabled("cmd_checkUpdates") ? "root" : null
				);
				break;
			case "cmd_checkUpdatesRange": 
				this.currentView.getSeparatedRange(null, {}).forEach(function(item) {
					if (item.type == FoxAge2chUtils.TYPE_BOARD && !item.skip)
						FoxAge2chService.checkUpdates(item.id);
				});
				break;
			case "cmd_openUpdates": 
				FoxAge2chService.openUpdates(this.currentView.currentItem.id);
				break;
			case "cmd_openUpdatesAll": 
				FoxAge2chService.openUpdates(
					FoxAge2chService.isCommandEnabled("cmd_openUpdates") ? "root" : null
				);
				break;
			case "cmd_openUpdatesRange": 
				this.currentView.getSeparatedRange(null, {}).forEach(function(item) {
					FoxAge2chService.openUpdates(item.id);
				});
				break;
			case "cmd_fetchTitle": 
				FoxAge2chService.fetchTitle(this.currentView.currentItem);
				break;
			case "cmd_newSeparator": 
				var index = this.currentView.selection.currentIndex;
				var sepItem = FoxAge2chUtils.createSeparatorItem();
				FoxAge2chService.insertItem(sepItem, this.currentView.currentItem);
				this.currentView.selectIndex(index);
				break;
			case "cmd_findThread": 
			case "cmd_findNextThread": 
				window.openDialog(
					"chrome://foxage2ch/content/findThread.xul", "FoxAge2ch:FindThread",
					"chrome,centerscreen,modal,dialog=no,all", this.currentView.currentItem.id
				);
				break;
			case "cmd_transfer": 
				window.openDialog(
					"chrome://foxage2ch/content/transfer.xul", "FoxAge2ch:Transfer",
					"chrome,centerscreen,dialog=no,modal", this.currentView.currentItem.id
				);
				break;
			case "cmd_delete": 
				if (FoxAge2chUtils.prefs.getBoolPref("warnOnDelete")) {
					var confirmMsg = FoxAge2chUtils.getLocaleString("CONFIRM_DELETE");
					if (!FoxAge2chUtils.prompt.confirm(window, "FoxAge2ch", confirmMsg))
						return;
				}
				var index = this.currentView.selection.currentIndex;
				FoxAge2chService.removeItem(this.currentView.currentItem);
				// ツリー再描画前に選択していた行を選択しなおす
				// 注意: ツリーの最下行を選択していた場合、存在しない行を選択しようとすることになる。
				//       その場合、xdIFoxAge2chTreeView#selectIndex 側で行番号が補正される。
				this.currentView.selectIndex(index);
				break;
			case "cmd_showInfo": 
				window.openDialog(
					"chrome://foxage2ch/content/showInfo.xul", "FoxAge2ch:ShowInfo", 
					"chrome,centerscreen,modal", this.currentView.currentItem.id
				);
				break;
		}
	},

	onEvent: function F2_onEvent(aEvent) {},

	////////////////////////////////////////////////////////////////////////////////
	// Helpers

	// commandset#foxage2chCommands@oncommandupdate
	// FoxAge2chUI.buildContextMenuからcommandDispatcher経由で呼び出して各コマンドの状態を更新する。
	onCommandUpdate: function F2_onCommandUpdate() {
		this._setCommandDisabled("cmd_checkUpdates");
		this._setCommandDisabled("cmd_checkUpdatesRange");
		this._setCommandDisabled("cmd_openUpdates");
		this._setCommandDisabled("cmd_openUpdatesRange");
	},

	_setCommandDisabled: function F2__setCommandDisabled(aCommand) {
		var enabled = this.isCommandEnabled(aCommand);
		var elt = document.getElementById(aCommand);
		FoxAge2chUtils.assert(elt, "command element not found.");	// #debug
		if (enabled)
			elt.removeAttribute("disabled");
		else
			elt.setAttribute("disabled", "true");
	},

	get currentView() {
		return document.commandDispatcher.focusedElement.view;
	},

};


