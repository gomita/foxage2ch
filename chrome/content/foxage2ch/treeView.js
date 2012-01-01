////////////////////////////////////////////////////////////////
// FoxAge2chTreeView

// constructor
// @param String aMode "both": 板とスレ両方を表示
//                     "boards": 板のみ表示
//                     "threads": スレのみ表示
// @param String aRoot ルートのアイテムID
// @param Boolean aDontRecurse サブフォルダの再帰表示
function FoxAge2chTreeView(aMode, aRoot, aRecurse) {
	this._mode = aMode;
	this._root = aRoot;
	this._recurse = aRecurse;
	this._filter = null;
}

FoxAge2chTreeView.prototype = {

	get atomSvc() {
		var svc = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
		this.__defineGetter__("atomSvc", function() svc);
		return this.atomSvc;
	},

	// nsITreeBoxObject
	_treeBoxObject: null,

	////////////////////////////////////////////////////////////////
	// visible items builder

	_visibleItems: [],

	_currentLevel: 0,

	_parentIndex: -1,

	_buildVisibleList: function TV__buildVisibleList() {
		this._visibleItems = [];
		this._currentLevel = 0;
		this._parentIndex = -1;
		if (!this._root)
			// サブペインを非表示にするためroot = nullとした時、これ以上の処理は不要
			return;
		// process for each child of the root folder
		var childItems = FoxAge2chService.getChildItems(this._root, {});
		this._processChildItems(childItems);
		// this._dumpVisibleList();	// #debug
	},

	_processChildItems: function TV__processChildItems(aChildItems) {
		// process for each child
		for (var i = 0; i < aChildItems.length; i++) {
			var item = aChildItems[i];
			var show = false;
			switch (this._mode) {
				case "both"   : show = true; break;
				case "threads": show = (item.type == FoxAge2chUtils.TYPE_THREAD); break;
				case "boards" : show = (item.type != FoxAge2chUtils.TYPE_THREAD); break;
				case "filter" : show = this._computeShowForFilterMode(item); break;
			}
			// compute and set |level|, |hasNext| and |parentIndex| properties
			var level = this._currentLevel;
			var hasNext = i < aChildItems.length - 1;
			var parentIndex = this._parentIndex;
			var grandChildItems = null;
			var empty = null;
			// if child item is a folder, compute and set |empty| properties
			if (item.type == FoxAge2chUtils.TYPE_BOARD) {
				grandChildItems = FoxAge2chService.getChildItems(item.id, {});
				empty = grandChildItems.length == 0;
			}
			if (show)
				this._visibleItems.push({
					item: item, level: level, hasNext: hasNext, parentIndex: parentIndex, empty: empty
				});
			// if child item is an open folder, process grandchildren recursive
			// フィルタモードの場合はフォルダが開いているかどうかによらず再帰する
			if (this._recurse && item.type == FoxAge2chUtils.TYPE_BOARD && (item.open || this._mode == "filter")) {
				var parentIndexBak = this._parentIndex;
				this._parentIndex = this._visibleItems.length - 1;
				this._currentLevel++;
				this._processChildItems(grandChildItems);
				this._currentLevel--;
				this._parentIndex = parentIndexBak;
			}
		}
	},

	_computeShowForFilterMode: function TV__computeShowForFilterMode(aItem) {
		if (aItem.type != FoxAge2chUtils.TYPE_THREAD)
			return false;
		// タイトルのみの検索時、最初のshowをtrueにして条件でフィルタアウトする
		// 「filer:」文字列での検索時、最初のshowをfalseにして条件でフィルタインする
		var show = (!this._filter.status && !this._filter.over1000 && !this._filter.exclude);
		if (this._filter.status && aItem.status & this._filter.status)
			show = true;
		if (this._filter.over1000 && aItem.lastRes >= (aItem.maxRes || 1000))
			show = true;
		if (aItem.exclude && this._filter.status & FoxAge2chUtils.STATUS_DATOUT)
			show = false;
		if (aItem.exclude && this._filter.exclude)
			show = true;
		if (this._filter.title && aItem.title.toLowerCase().indexOf(this._filter.title) < 0)
			show = false;
		return show;
	},

	////////////////////////////////////////////////////////////////
	// xdIFoxAge2chTreeView

	get currentItem() {
		var idx = this.selection.currentIndex;
		if (idx < 0)
			return null;
		return this.itemForTreeIndex(idx);
	},

	get root() {
		return this._root;
	},

	set root(val) {
		var lastRowCount = this.rowCount;
		this._root = val;
		this._buildVisibleList();
		this._treeBoxObject.rowCountChanged(0, this.rowCount - lastRowCount);
		this._treeBoxObject.invalidate();
		return val;
	},

	rebuildTree: function TV_rebuildTree() {
		// @see FoxAge2chUI.done
		FoxAge2chUtils.assert(this._treeBoxObject, "no treeBoxObject");	// #debug
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		this.root = this.root;
	},

	redrawItem: function TV_redrawItem(aItemId) {
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		var idx = this.treeIndexForItem(aItemId);
		if (idx < 0)
			return;
		this._treeBoxObject.invalidateRow(idx);
	},

	clearDrawingCaches: function TV_clearDrawingCaches() {
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		this._treeBoxObject.clearStyleAndImageCaches();
	},

	selectIndex: function TV_selectIndex(aIndex) {
		if (aIndex < 0)
			return;
		// 存在しない行を選択しようとした場合の補正
		if (aIndex >= this.rowCount)
			aIndex = this.rowCount - 1;
		this.selection.clearSelection();
		this.selection.select(aIndex);
		this._treeBoxObject.ensureRowIsVisible(aIndex);
		this._treeBoxObject.treeBody.parentNode.focus();
	},

	itemForTreeIndex: function TV_itemForTreeIndex(aIndex) {
		if (aIndex < 0 || aIndex >= this.rowCount)
			throw Cr.NS_ERROR_INVALID_ARG;
		FoxAge2chUtils.assert(this._visibleItems[aIndex], "out of range: " + aIndex, 2);	// #debug
		return this._visibleItems[aIndex].item;
	},

	treeIndexForItem: function TV_treeIndexForItem(aItem) {
		var itemId = typeof(aItem) == "object" ? aItem.id : aItem;
		for (var i = 0; i < this._visibleItems.length; i++) {
			if (this.itemForTreeIndex(i).id == itemId)
				return i;
		}
		return -1;
	},

	toggleAllFolders: function TV_toggleAllFolders(aForceClose) {
		var selItem = !this.filter && this.selection.count && this.selection.currentIndex >= 0 ?
		              this.itemForTreeIndex(this.selection.currentIndex) : null;
		var open = aForceClose ? false 
		         : !this._visibleItems.some(function(elt) { return elt.item.open === true; });
		FoxAge2chService.getChildItems("root", {}).forEach(function(board) {
			FoxAge2chService.changeItemProperty(board, "open", open);
		});
		this.rebuildTree();
		if (selItem)
			this.selectIndex(this.treeIndexForItem(selItem));
	},

	getSeparatedRange: function TV_getSeparatedRange(aStartIndex, aItemsCount) {
		if (!aStartIndex)
			aStartIndex = this.selection.currentIndex;
		var aStartLevel = this.getLevel(aStartIndex);
		var ret = [];
		for (var i = aStartIndex + 1; i < this.rowCount; i++) {
			if (this._visibleItems[i].level != aStartLevel)
				continue;
			if (this.isSeparator(i))
				break;
			ret.push(this.itemForTreeIndex(i));
		}
		aItemsCount.value = ret.length;
		return ret;
	},

	get filter() {
		return this._filter;
	},

	set filter(val) {
		if (this._mode != "filter") {
			// フィルタのセット時、現在のプロパティをバックアップする
			this.__mode = this._mode;
			this.__root = this._root;
			this.__recurse = this._recurse;
		}
		this._mode    = val ? "filter" : this.__mode;
		this._root    = val ? "root"   : this.__root;
		this._recurse = val ? true     : this.__recurse;
		this._filter  = val;
		this.rebuildTree();
		return val;
	},

	////////////////////////////////////////////////////////////////
	// helpers

	_ensureValidRow: function TV__ensureValidRow(aIndex) {
		if (aIndex < 0 || aIndex >= this.rowCount)
			throw Cr.NS_ERROR_INVALID_ARG;
	},

	// 現在ドラッグ中の転送データからtext/x-moz-tree-index形式の数値を取得する。
	// ドラッグ中ではない場合や転送データにtext/x-moz-tree-index形式のデータが含まれない場合-1を返す。
	getSourceIndexFromDrag: function TV_getSourceIndexFromDrag(dataTransfer) {
		if (dataTransfer) {
			// canDrop, drop からの呼び出し
			if (!dataTransfer.types.contains(FoxAge2chUtils.DROP_TYPE))
				return -1;
			else
				return parseInt(dataTransfer.getData(FoxAge2chUtils.DROP_TYPE));
		}
		// toggleOpenState からの呼び出し
		if (!FoxAge2chUtils.dragSession)
			return -1;
		var xferData = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
		xferData.addDataFlavor(FoxAge2chUtils.DROP_TYPE);
		FoxAge2chUtils.dragSession.getData(xferData, 0);
		var obj = {}, len = {};
		try {
			xferData.getAnyTransferData({}, obj, len);
		}
		catch (ex) {
			return -1;
		}
		obj = obj.value.QueryInterface(Ci.nsISupportsString).data;
		obj = parseInt(obj.substring(0, len.value), 10);
		return obj;
	},

	// #debug-begin
	get treeName() {
		return this._treeBoxObject ? this._treeBoxObject.treeBody.parentNode.id : "???";
	},

	_dumpVisibleList: function TV__dumpVisibleList() {
		dump("\n" + arguments.callee.name + "\n");
		for (var i = 0; i < this._visibleItems.length; i++) {
			dump("[" + i + "] " + this._visibleItems[i].toSource() + "\n");
		}
		dump("\n");
	},
	// #debug-end

	////////////////////////////////////////////////////////////////
	// nsITreeView

	get rowCount() {
		return this._visibleItems.length;
	},
	selection: null,
	getRowProperties: function TV_getRowProperties(index, properties) {},
	getCellProperties: function TV_getCellProperties(row, col, properties) {
		var item = this.itemForTreeIndex(row);
		var atoms = [];
		if (col.index == 0)
			atoms.push("title");
		// 形式
		switch (item.type) {
			case FoxAge2chUtils.TYPE_THREAD   : atoms.push("thread"); break;
			case FoxAge2chUtils.TYPE_BOARD    : atoms.push("board"); break;
			case FoxAge2chUtils.TYPE_SEPARATOR: atoms.push("separator"); break;
		}
		// BBS
		if (item.type == FoxAge2chUtils.TYPE_BOARD) {
			switch (item.bbs) {
				case FoxAge2chUtils.BBS_PINK : atoms.push("pink"); break;
				case FoxAge2chUtils.BBS_MACHI: atoms.push("machi"); break;
				case FoxAge2chUtils.BBS_JBBS : atoms.push("jbbs"); break;
			}
			if (item.skip)
				atoms.push("skip");
		}
		// ステータス
		if (item.status & FoxAge2chUtils.STATUS_CHECKING)
			atoms.push("checking");
		if (item.status & FoxAge2chUtils.STATUS_UPDATED)
			atoms.push("updated");
		if (item.status & FoxAge2chUtils.STATUS_DATOUT)
			atoms.push("datout");
		if (item.status & FoxAge2chUtils.STATUS_ERROR)
			atoms.push("error");
		// その他
		if (item.lastRes >= (item.maxRes || 1000))
			atoms.push("over1000");
		if (item.exclude)
			atoms.push("exclude");
		atoms.forEach(function(atom) {
			properties.AppendElement(this.atomSvc.getAtom(atom));
		}, this);
	},
	getColumnProperties: function TV_getColumnProperties(col, properties) {},
	isContainer: function TV_isContainer(index) {
		this._ensureValidRow(index);
		return this.itemForTreeIndex(index).type == FoxAge2chUtils.TYPE_BOARD;
	},
	isContainerOpen: function TV_isContainerOpen(index) {
		this._ensureValidRow(index);
		return this.itemForTreeIndex(index).open;
	},
	isContainerEmpty: function TV_isContainerEmpty(index) {
		this._ensureValidRow(index);
		return this._visibleItems[index].empty;
	},
	isSeparator: function TV_isSeparator(index) {
		this._ensureValidRow(index);
		return this.itemForTreeIndex(index).type == FoxAge2chUtils.TYPE_SEPARATOR;
	},
	isSorted: function TV_isSorted() { return false; },
	canDrop: function TV_canDrop(targetIndex, orientation, dataTransfer) {
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		if (this.selection.count != 1)
			return false;
		if (FoxAge2chUtils.dragSession.sourceNode != this._treeBoxObject.treeBody)
			return false;
		var sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
		// 適切なデータ型の転送データ以外のドロップ不可
		if (sourceIndex == -1)
			return false;
		// フォルダ・区切り以外のドラッグ＆ドロップ不可
		if (!this.isContainer(sourceIndex) && !this.isSeparator(sourceIndex))
			return false;
		// フォルダへのドロップ不可
		if (orientation == Ci.nsITreeView.DROP_ON)
			return false;
		// 現在行の前後へのドロップ不可
		if (sourceIndex == targetIndex || sourceIndex == targetIndex + orientation)
			return false;
		// 末尾のフォルダまたはリーフの下側へのドロップ許可
		if (targetIndex == this.rowCount - 1 && orientation == Ci.nsITreeView.DROP_AFTER)
			return true;
		// 板または区切り以外の前後へのドロップ不可
		if (!this.isContainer(targetIndex) && !this.isSeparator(targetIndex))
			return false;
		// 空ではなく開いているフォルダの直後へのドロップ不可
		if (this.isContainer(targetIndex) && 
		    this.isContainerOpen(targetIndex) && 
		    !this.isContainerEmpty(targetIndex) && 
		    orientation == Ci.nsITreeView.DROP_AFTER)
			return false;
		// ドロップ許可
		return true;
	},
	drop: function TV_drop(targetIndex, orientation, dataTransfer) {
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		if (!this.canDrop(targetIndex, orientation, dataTransfer))
			return;
		if (this.selection.count != 1 || targetIndex < 0 || targetIndex > this.rowCount - 1)
			return;
		if (FoxAge2chUtils.dragSession.sourceNode != this._treeBoxObject.treeBody)
			return;
		var sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
		FoxAge2chUtils.assert(sourceIndex >= 0, "invalid sourceIndex");	// #debug
		if (sourceIndex < targetIndex && orientation == Ci.nsITreeView.DROP_BEFORE)
			targetIndex--;
		if (sourceIndex > targetIndex && orientation == Ci.nsITreeView.DROP_AFTER)
			targetIndex++;
		var sourceItem = this.itemForTreeIndex(sourceIndex);
		var targetItem = this.itemForTreeIndex(targetIndex);
		if (targetItem.type == FoxAge2chUtils.TYPE_THREAD) {
			// drop before/after leaf item
			targetIndex = this.getParentIndex(targetIndex);
			targetItem = this.itemForTreeIndex(targetIndex);
			FoxAge2chUtils.reportError("drop before/after leaf item: " + targetIndex + ", " + targetItem.title);	// #debug
		}
		FoxAge2chService.moveItem(sourceItem, targetItem);
		// select and focus the source item
		this.selectIndex(this.treeIndexForItem(sourceItem));
	},
	getParentIndex: function TV_getParentIndex(rowIndex) {
		if (rowIndex < 0)
			// XXX ツリー下側の空白部へのドロップ時にgetParentIndex(-1)が呼び出される問題への対策
			return -1;
		this._ensureValidRow(rowIndex);
		return this._visibleItems[rowIndex].parentIndex;
	},
	hasNextSibling: function TV_hasNextSibling(rowIndex, afterIndex) {
		this._ensureValidRow(rowIndex);
		return this._visibleItems[rowIndex].hasNext;
	},
	getLevel: function TV_getLevel(index) {
		this._ensureValidRow(index);
		return this._visibleItems[index].level;
	},
	getImageSrc: function TV_getImageSrc(row, col) {},
	getProgressMode: function TV_getProgressMode(row, col) {},
	getCellValue: function TV_getCellValue(row, col) {},
	getCellText: function TV_getCellText(row, col) {
		var item = this.itemForTreeIndex(row);
		// タイトル
		if (item.type == FoxAge2chUtils.TYPE_THREAD && item.status & FoxAge2chUtils.STATUS_UPDATED)
			// 未読ありスレ
			return "(" + (item.lastRes - item.readRes) + ") " + item.title;
		else if (item.type == FoxAge2chUtils.TYPE_BOARD && item.status & FoxAge2chUtils.STATUS_UPDATED)
			// 未読あり板
			return item.title + " (" + item.unread + ")";
		else
			return item.title;
	},
	setTree: function TV_setTree(tree) {
		// FoxAge2chUtils.trace(this.treeName);	// #debug
		if (!tree) FoxAge2chUtils.assert(!this._root, "You must set .root to null before setting .view to null.");	// #debug
		this._treeBoxObject = tree;
		if (tree)
			this._buildVisibleList();
		else
			this._visibleItems = null;
	},
	toggleOpenState: function TV_toggleOpenState(index) {
		// ドラッグ開始時に現在選択している行番号を転送データにセットする方式の場合、
		// ドラッグオーバーによってフォルダ開閉が生じると行番号が狂ってしまうため、
		// ドラッグオーバーによるフォルダの開閉を阻止する。
		// 条件がnsIDragSessionの有無だけだと、通常ツリー表示でURLを
		// ドラッグ＆ドロップして追加した際に、FoxAge2chUI.onItemAddedで板のフォルダが開かない。
		if (this.getSourceIndexFromDrag() >= 0) {
			FoxAge2chUtils.reportError("suppress toggleOpenState while dragging a tree item.");	// #debug
			return;
		}
		var lastRowCount = this.rowCount;
		// change |open| property
		var item = this.itemForTreeIndex(index);
		FoxAge2chUtils.assert(item.type == FoxAge2chUtils.TYPE_BOARD, "invalid calling of toggleOpenState");	// #debug
		// XXX フォーカスしているツリーのみリビルドするため、オブザーバへの通知を行わない
		FoxAge2chService.changeItemProperty(item, "open", !item.open);
		this._buildVisibleList();
		this._treeBoxObject.rowCountChanged(index + 1, this.rowCount - lastRowCount);
		// フォルダの+/-マークを再描画
		this._treeBoxObject.invalidateRow(index);
	},
	cycleHeader: function TV_cycleHeader(col) {},
	selectionChanged: function TV_selectionChanged() {},
	cycleCell: function TV_cycleCell(row, col) {},
	isEditable: function TV_isEditable(row, col) { return false; },
	isSelectable: function TV_isSelectable(row, col) {},
	setCellValue: function TV_setCellValue(row, col, value) {},
	setCellText: function TV_setCellText(row, col, value) {},
	performAction: function TV_performAction(action) {},
	performActionOnRow: function TV_performActionOnRow(action, row) {},
	performActionOnCell: function TV_performActionOnCell(action, row, col) {},

	////////////////////////////////////////////////////////////////
	// nsISupports

	QueryInterface: function TV_QueryInterface(aIID) {
		if (aIID.equals(Ci.nsITreeView) || 
		    aIID.equals(Ci.xdIFoxAge2chTreeView) || 
		    aIID.equals(Ci.nsISupports)) {
			return this;
		}
		throw Cr.NS_ERROR_NO_INTERFACE;
	}

};


