var FoxAge2chOverlay = {

	get URL() {
		return "chrome://foxage2ch/content/foxage2ch.xul";
	},

	get windowMediator() {
		delete this.windowMediator;
		return this.windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].
		                             getService(Ci.nsIWindowMediator);
	},

	// nsIPrefBranch
	_prefBranch: null,

	// ツールバーボタンへのドラッグオーバー開始時刻
	_dragStartTime: null,

	init: function() {
		this._prefBranch = gPrefService.getBranch("extensions.foxage2ch.");
		if (this._prefBranch.prefHasUserValue("startupKey")) {
			var key = this._prefBranch.getCharPref("startupKey");
			var elt = document.getElementById("key_viewFoxAge2chSidebar");
			if (/^[a-z]$/i.test(key))
				elt.setAttribute("key", key);
			else
				elt.parentNode.removeChild(elt);
		}
		if (XULBrowserWindow.inContentWhitelist.indexOf(this.URL) < 0)
			XULBrowserWindow.inContentWhitelist.push(this.URL);
	},

	handleEvent: function(event) {
		switch (event.type) {
			case "click": 
				if (event.button != 1)
					return;
				this._openUI(1);
				// メニュー項目を中クリック時、親のポップアップをすべて閉じる
				if (event.target.localName == "menuitem") {
					var elt = event.target;
					while (elt.parentNode) {
						if (elt.localName == "menupopup")
							elt.hidePopup();
						elt = elt.parentNode;
					}
				}
				// [Firefox28+] Panel UI内のボタンを中クリック時、Panel UIを閉じる
				if (event.target.getAttribute("cui-areatype") == "menu-panel")
					PanelUI.hide();
				break;
			case "command": 
				// sourceEventの有無でクリック由来かキーボードショートカット由来かを判別
				if (!event.sourceEvent && (event.ctrlKey || event.shiftKey || event.metaKey))
					this._openUI(1);
				else
					this._openUI(0);
				break;
			case "dragenter": 
				event.preventDefault();
				this._dragStartTime = Date.now();
				break;
			case "dragover": 
				// ドラッグオーバー開始から一定時間経過後、ボタンクリック時の動作を実行
				event.preventDefault();
				if (this._dragStartTime && Date.now() - this._dragStartTime > 1000) {
					this._dragStartTime = null;
					this._openUI(0, true);
				}
				break;
			default: 
		}
	},

	_openUI: function(aButton, aForceOpen) {
		var mode = this._prefBranch.getIntPref("startupMode." + aButton.toString());
		switch (mode) {
			case 1: 
				// サイドバーで開く
				aForceOpen ? SidebarUI.show("viewFoxAge2chSidebar")
				           : SidebarUI.toggle("viewFoxAge2chSidebar");
				break;
			case 2: 
				// ウィンドウで開く
				var win = this.windowMediator.getMostRecentWindow("FoxAge2ch");
				if (win)
					return win.focus();
				window.openDialog(this.URL, "FoxAge2ch", "chrome,all,resizable,dialog=no");
				break;
			case 3: 
				// タブで開く
				switchToTabHavingURI(this.URL, true);
				break;
			default: 
		}
	},

};


window.addEventListener("load", function() { FoxAge2chOverlay.init(); }, false);


