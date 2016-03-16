/*global Cosmoz, Polymer, window */
(function () {

	'use strict';

	Polymer({

		is: 'cosmoz-omnitable',

		properties: {
			/**
			 * List of "disabled headers" - headers not fitting in the current screen due to screen size.
			 */
			disabledHeaders: {
				type: Array,
				notify: true,
				value: function () {
					return [];
				}
			},

			/**
			 * List of data to display
			 */
			data: {
				type: Array,
				value: function () {
					return [];
				}
			},

			/**
			 * Table headers/column definitions, usually configued with markup.
			 */
			headers: {
				type: Array,
				notify: true
			},

			/**
			 * Table headers to display (headers not disabled or grouped on)
			 */
			columnHeaders: {
				type: Object,
				computed: '_computeColumnHeaders(headers.length, sortedFilteredGroupedItems, groupOn, disabledHeaders.length)'
			},

			/**
			 * Whether to hide all groups but the first on initial load
			 */
			hideButFirst: {
				type: Boolean,
				value: true
			},

			/**
			 * Whether to hide groups with no items.
			 */
			hideEmptyGroups: {
				type: Boolean,
				value: true
			},

			/**
			 * Whether to display checkboxes for item selection, and to make use of the bottom-bar for selection actions.
			 * Will be enabled automatically if one or more elements has the attribute `action` set in the light DOM.
			 */
			selectionEnabled: {
				type: Boolean,
				value: false
			},

			/**
			 * List of selected rows/items in `data`.
			 * This is an empty array on startup.
			 * (this behavior is different from `Polymer.IronMultiSelectableBehavior` whose `selectedItems` property
			 * is undefined until something has been selected).
			 */
			selectedItems: {
				type: Array,
				notify: true,
				readOnly: true,
				value: function () {
					return [];
				}
			},

			/**
			 * The header ID to sort on.
			 */
			sortOn: {
				type: String,
				value: null
			},

			/**
			 * The header ID to group on.
			 */
			groupOn: {
				type: String,
				value: null,
				observer: '_groupOnChanged'
			},

			/**
			 * Workaround kicker to cause regrouping.
			 */
			groupKick: {
				type: Number,
				value: 0
			},

			/**
			 * Workaround kicker to cause refiltering.
			 */
			filterKick: {
				type: Number,
				value: 0
			},

			/**
			 * Items matching current set filter(s)
			 */
			filteredItems: {
				type: Array,
				computed: '_filterItems(filterKick)'
			},

			/**
			 * Grouped items structure after filtering.
			 */
			filteredGroupedItems: {
				type: Array,
				computed: '_groupItems(filteredItems, groupOn, groupKick)'
			},

			/**
			 * Sorted items structure after filtering and grouping.
			 * Set by `_sortFilteredGroupedItems()` due to the async nature of web workers.
			 */
			sortedFilteredGroupedItems: {
				type: Array
			},

			/**
			 * Keep track of width-changes to identify if we go bigger or smaller
			 */
			_previousWidth: {
				type: Number,
				value: 0
			}
		},

		observers: [
			'_sortFilteredGroupedItems(filteredGroupedItems, sortOn)',
			'_dataChanged(data.length)'
		],

		behaviors: [
			Polymer.IronResizableBehavior,
			Cosmoz.TranslatableBehavior
		],

		listeners: {
			'iron-resize': 'updateWidths'
		},

		/**
		 * Keeps track of data re-evaluation needs when it comes to sorting, filtering and grouping.
		 * This is to avoid making too generic property observations but rather to make well-informed
		 * decisions when to use computing power.
		 */
		_needs: {},

		/**
		 * Called when data is changed to setup up needs and check workers/filtering
		 */
		_dataChanged: function () {
			this._needs.grouping = true;
			this._needs.filtering = true;
			this._needs.sorting = true;

			if (this._webWorkerReady && this.headers) {
				this.filterKick += 1;
			}

			if (this.data.length !== 0) {
				this.setHeaderValues();
			}
		},

		/**
		 * Helper method to remove an item from `data` and cause re-evaluation of table data.
		 * @param  {Object} item Item to remove
		 * @return {Boolean}      Whether `data` or `selectedItems` changed
		 */
		removeItem: function (item) {
			var change = false,
				removed;
			// Removes item from selection if needed.
			if (this.selectedItems) {
				removed = this.arrayDelete('selectedItems', item);
				change = removed.length > 0 || change;
			}
			removed = this.arrayDelete('data', item);
			change = removed.length > 0 || change;
			if (change && item.checked) {
				delete item.checked;
			}
			return change;
		},

		/**
		 * Remove multiple items from `data`
		 */
		removeItems: function (items) {
			var groupKick = false, i;
			for (i = items.length - 1; i >= 0; i -= 1) {
				groupKick = this.removeItem(items[i]) ? true : groupKick;
			}
			if (groupKick) {
				this.groupKick += 1;
				this.fire('data-changed', {
					action: 'removeItem',
					data: this.data
				});
			}
		},

		/**
		 * Turn an `action` event into a `run` event
		 * @param  {Event} event  `action` event
		 * @param  {Object} detail `action` event details
		 */
		onAction: function (event, detail) {
			detail.item.dispatchEvent(new window.CustomEvent('run', {
				bubbles: true,
				cancelable: true,
				detail: {
					omnitable: this,
					items: this.selectedItems
				}
			}));
			event.stopPropagation();
		},

		created: function () {
			this.rendered = false;
			this._needs = {
				grouping: true,
				filtering: true,
				sorting: true
			};
		},

		ready: function () {
			this._needs = {
				grouping: true,
				filtering: true,
				sorting: true
			};
		},

		attached: function () {
			var hasActions = Polymer.dom(this.$.actions).getDistributedNodes().length > 0;
			if (hasActions) {
				this.selectionEnabled = true;
			}
			this.$.groupedList.scrollTarget = this.$.scroller;
			this.setHeadersFromMarkup();
			this.rendered = true;
		},

		_groupOnChanged: function (newValue, oldValue) {
			this._needs.grouping = true;
			if (this.filteredItems) {
				this.groupKick += 1;
			}
		},

		onAllCheckboxChange: function (event, detail) {

			if (event.target === null) {
				return;
			}

			var checked = event.target.checked;

			if (!this.sortedFilteredGroupedItems) {
				return;
			}

			this.sortedFilteredGroupedItems.forEach(function (group, index) {
				this.setGroupProperty(index, 'checked', checked);
				this.selectGroupItems(group);
			}.bind(this));
		},
		onGroupCheckboxChange: function (event) {
			var group = event.model.item;
			this.selectGroupItems(group);
			event.preventDefault();
			event.stopPropagation();
		},
		onItemCheckboxChange: function (event, detail) {
			var item = event.model.item;
			this.selectItem(item);
		},
		selectGroupItems: function (group) {
			var
				that = this,
				groupIndex = this.sortedFilteredGroupedItems.indexOf(group);

			group.items.forEach(function (item, index) {
				that.setItemPropery(groupIndex, index, 'checked', group.checked);

				if (!item.placeholder) {
					that.selectItem(item);
				}
			});
		},

		setItemPropery: function (groupIndex, itemIndex, path, value) {
			this.set('sortedFilteredGroupedItems.#' + groupIndex + '.items.#' + itemIndex + '.' + path, value);
		},

		setGroupProperty: function (groupIndex, path, value) {
			this.set('sortedFilteredGroupedItems.#' + groupIndex + '.' + path, value);
		},

		selectItem: function (item) {
			var itemIndex;
			if (item.checked) {
				if (this.selectedItems.indexOf(item) === -1) {
					this.push('selectedItems', item);
				}
			} else if (this.selectedItems) {
				itemIndex = this.selectedItems.indexOf(item);
				if (itemIndex > -1) {
					this.splice('selectedItems', itemIndex, 1);
				}
			}
		},
		toggleGroup: function (event) {
			this.$.body.querySelector('#groupedList').toggleFold(event.model);
		},

		getFoldIcon: function (folded) {
			return folded ? 'expand-more' : 'expand-less';
		},

		filterItem: function (item) {
			var hide = false, that = this;
			this.headers.some(function (header, headerIndex) {
				if (header.filters !== undefined && header.filters.length > 0) {
					var filterFail = true;
					header.filters.some(function (headerFilter, headerFilterIndex) {
						var itemVal = that.resolveProp(item, header.id);
						if (itemVal === headerFilter.value) {
							filterFail = false;
							return true;
						}
						if (typeof itemVal === 'object' && that.renderObject(itemVal, false, header) === headerFilter.label) {
							filterFail = false;
							return true;
						}
					});
					if (filterFail) {
						hide = true;
						return true;
					}
				}
			});
			item.visible = !hide;
		},

		filterItems: function (event, detail, sender) {
			this._needs.filtering = true;
			this.filterKick += 1;
		},

		renderItemProperty: function (itemNotify, header, ui) {
			var
				item = itemNotify.base,
				prop;
			if (item === undefined || header === undefined) {
				return '';
			}
			// TODO: Cleaner solution?
			if (item.placeholder) {
				return '';
			}
			prop = this.resolveProp(item, header.id);
			return this.renderObject(prop, ui, header);
		},

		renderObject: function (obj, ui, header) {
			if (obj === undefined || obj === '') {
				return '';
			}

			if (header.renderFunc) {
				return header.renderFunc.call(this.dataHost, obj);
			}

			if (obj instanceof Object) {
				return "Can't render " + JSON.stringify(obj);
			}

			return obj;
		},

		/**
		 * Render a unique list of possible values to filter the dataset with, for each header/column.
		 * @param {[type]} item [description]
		 */
		setHeaderValues: function () {
			this.data.forEach(function (item, index) {
				this.headers.forEach(function (header, headerIndex) {
					var
						value = this.resolveProp(item, header.id),
						hasValue = false,
						label = this.renderObject(value, false, header);

					header.values.some(function (headerValue, headerValueIndex) {
						if (headerValue.label === label) {
							hasValue = true;
							return true;
						}
					});
					if (!hasValue) {
						header.values.push({
							label: label,
							value: value
						});
					}
				}.bind(this));
			}.bind(this));
			this._sortHeaderValues();
		},

		_sortHeaderValues: function () {
			this.headers.forEach(function (header, headerIndex) {
				var valueLength = header.values.length;
				header.values.sort(function (a, b) {
					if (a.label < b.label) {
						return -1;
					}
					return 1;
				});
			}.bind(this));

		},

		dataRowChanged: function (event, detail) {
			var
				element = event.target,
				model = event.model,
				header = event.model.__data__.header,
				item = event.model.__data__.item,
				value = element.value;

			if (header.type === 'number') {
				value = parseInt(value, 10);
			}
			model.set('item.' + header.id, value);

			//item[outerModel.header.id] = sender.value;
			this.fire('cz-data-row-changed', {
				model: model,
				item: item
			});
			this.fire('data-changed', {
				action: 'updateItem',
				data: this.data
			});
		},
		disableColumn: function () {
			var headerToDisable;
			// disables/hides columns that for example does not fit in the current screen size.
			this.columnHeaders.forEach(function (header, index) {
				if (headerToDisable === undefined || headerToDisable.priority >= header.priority) {
					headerToDisable = header;
				}
			});

			if (headerToDisable) {
				this.push('disabledHeaders', headerToDisable);
				this.async(this.updateWidths);
			}
		},
		enableColumn: function () {
			var
				headerToEnable,
				headerToEnableIndex;
			this.disabledHeaders.forEach(function (header, index) {
				if (headerToEnable === undefined || headerToEnable.priority < header.priority) {
					headerToEnable = header;
					headerToEnableIndex = index;
				}
			});

			this.splice('disabledHeaders', headerToEnableIndex, 1);
			// Fake a resize bigger event, in the off chance that we go past
			// the size of two columns in one resize, like maximizing a window
			this.async(function () {
				this.scalingUp = true;
				this.updateWidths({
					detail: {
						second: true
					}
				});
			});
		},

		getHeader: function (id) {
			var foundHeader;
			this.headers.some(function (header, index) {
				if (header.id === id) {
					foundHeader = header;
					return true;
				}
			});
			return foundHeader;
		},

		_computeColumnHeaders: function (headersNotify, sortedFilteredGroupedItems, groupOn, numDisabledHeaders) {
			if (!this.headers) {
				return;
			}
			var filteredHeaders = [];
			this.headers.forEach(function (header, index) {
				if (header.id !== groupOn && this.disabledHeaders.indexOf(header) === -1) {
					filteredHeaders.push(header);
				}
			}.bind(this));
			return filteredHeaders;
		},

		_getFunctionByName: function (name, context) {
			if (!name) {
				return undefined;
			}

			var
				parts = name.split('.'),
				func,
				funcName,
				i;
			if (parts.length === 1) {
				func = this.dataHost[name];
			} else {
				funcName = parts.pop();
				for(i = 0; i < parts.length; i += 1) {
					context = context[parts[i]];
				}
				func = context[funcName];
			}
			return typeof func === 'function' ? func : undefined;
		},

		setHeadersFromMarkup: function () {
			var ctx = this,
				markupHeaders = Polymer.dom(this).querySelectorAll('header'),
				newHeaders = [];

			markupHeaders.forEach(function (headerElement, index) {
				var header = {
						disabled: false,
						editable: headerElement.hasAttribute('editable'),
						id: headerElement.id,
						linkbase: headerElement.getAttribute('linkbase'),
						linkprop: headerElement.getAttribute('linkprop'),
						name: Polymer.dom(headerElement).innerHTML,
						priority: parseInt(headerElement.getAttribute('priority') || 0, 10),
						type: headerElement.getAttribute('type') || 'default',
						values: [],
						filters: [],
						wrap: headerElement.hasAttribute('wrap')
					},
					defaultRenderFunc = 'render' + header.type.charAt(0).toUpperCase() + header.type.substr(1);
				header.renderFunc = ctx._getFunctionByName(headerElement.getAttribute('render-func') || defaultRenderFunc, window);
				newHeaders.push(header);
			});
			this.headers = newHeaders;
			if (this._needs.grouping) {
				this.groupKick += 1;
			}
		},

		_filterItems : function (filterKick) {
			if (!this.headers) {
				return null;
			}
			if (!this.data || this.data.length === 0) {
				this._needs.grouping = false;
				this._needs.sorting = false;
				this._needs.filtering = false;
				return;
			}

			var
				that = this,
				filteredItems = [];

			this.data.forEach(function (item, index) {
				if (that._needs.filtering) {
					that.filterItem(item);
				}
				if (item.visible) {
					filteredItems.push(item);
				}
			});
			that._needs.filtering = false;
			that._needs.grouping = true;
			return filteredItems;
		},


		_groupItems: function (filteredItems, groupOn) {
			if (!this.headers) {
				return null;
			}

			if (!filteredItems || filteredItems.length === 0) {
				return;
			}
			if (!this._needs.grouping) {
				return filteredItems;
			}

			this._groupOnHeader = this.getHeader(groupOn);

			var groups = [],
				itemStructure = {},
				that = this;

			if (groupOn) {
				filteredItems.forEach(function (item, index) {
					var groupOnValue = that.resolveProp(item, that.groupOn);
					if (typeof groupOnValue === 'object') {
						groupOnValue = that.renderObject(groupOnValue, false, that._groupOnHeader);
					}
					if (groupOnValue !== undefined) {
						if (!itemStructure[groupOnValue]) {
							itemStructure[groupOnValue] = [];
						}
						itemStructure[groupOnValue].push(item);
					}
				});
			} else {
				itemStructure[''] = this.filteredItems;
			}

			Object.keys(itemStructure).forEach(function (key) {
				groups.push({
					name: key,
					id: key,
					items: itemStructure[key],
					visible: true
				});
			});

			groups.sort(function (a, b) {
				var v1 = that.resolveProp(a.items[0], that.groupOn), v2 = that.resolveProp(b.items[0], that.groupOn);
				if (typeof v1 === 'object' && typeof v2 === 'object') {
					return cz.tools.sortObject(v1, v2);
				}
				if (typeof v1 === 'number' && typeof v2 === 'number') {
					return v1 - v2;
				}
				if (typeof v1 === 'string' && typeof v2 === 'string') {
					return v1 < v2 ? -1 : 1;
				}
				if (typeof v1 === 'boolean' && typeof v2 === 'boolean') {
					if (v1 === v2) {
						return 0;
					}
					return v1 ? -1 : 1;
				}
				console.warn('unsupported sort', typeof v1, v1, typeof v2, v2);
				return 0;
			});

			if (this.hideButFirst && groups.length > 1) {
				groups.forEach(function (group, index) {
					if (index === 0) {
						return;
					}
					group.visible = false;
				});
			}

			this._needs.grouping = false;

			return groups;
		},

		_sortFilteredGroupedItems: function (filteredGroupedItems, sortOn) {
			if (!filteredGroupedItems) {
				return;
			}

			if (!sortOn) {
				this.set('sortedFilteredGroupedItems', filteredGroupedItems);
				return;
			}

			var items = [],
				numGroups = filteredGroupedItems.length,
				mappedItems,
				results = 0;

			filteredGroupedItems.forEach(function (group, index) {
				if (group.items && group.items.map) {
					// create a reduced version of the items array to transfer to the worker
					// with item index and property to sort on
					mappedItems = group.items.map(function (item, originalItemIndex) {
						return {
							index: originalItemIndex,
							value: item[sortOn]
						};
					});
					// Sort the reduced version of the array
					this.$.sortWorker.process({
						meta: {
							groupName: group.name,
							groupId: group.id,
							index: index
						},
						sortOn: 'value',
						data: mappedItems
					}, function (data) {
						results += 1;
						items[data.meta.index] = {
							name: data.meta.groupName,
							id: data.meta.groupId
						};
						items[data.meta.index].items = data.data.map(function (item, index) {
							return group.items[item.index];
						});
						if (results === numGroups) {
							this.set('sortedFilteredGroupedItems', items);
						}
					}.bind(this));
				}
			}.bind(this));
		},

		_computeIcon: function (item, expanded) {
			return expanded ? 'expand-less' : 'expand-more';
		},

		toggleExtraColumns: function (event, detail) {
			var item = event.model.item;
			this.$.groupedList.toggleCollapse(item);
		},

		getNumFiltered: function (group) {
			if (group === undefined || group === null) {
				return;
			}
			var groupIndex = this.groupedItems.indexOf(group), filteredItems = this.filteredSortedGroupedItems[groupIndex].length;
			return filteredItems - 1;
		},
		/**
		 * Enable/disable columns to properly fit in the available space.
		 *
		 * @param  {Event} event    (optional) Resize event, required for "bigger" events
		 * (set event.detail.bigger = true)
		 * @memberOf element/cz-omnitable
		 */
		updateWidths: function (event, detail, a) {

			if (!this.rendered || !this.columnHeaders) {
				return;
			}

			var body = this.$ ? this.$.body : null,
				bigger,
				groupedList,
				fits,
				headerTds,
				visibleColumns = this.columnHeaders.length,
				second = (event && event.detail && event.detail.second) || false,
				widthSetter,
				widthTds;

			if (!body) {
				return;
			}

			groupedList = this.$$('#groupedList');

			// TODO(pasleq): have encountered situations where groupedList was not available yet. Should check why.
			if (!groupedList) {
				return;
			}

			fits = this.$.scroller.scrollWidth <= this.$.scroller.clientWidth;
			/* Weird bug
			** In certain scenarios (sizing the window so that a column barely fits)
			** body.clientWidth actually expands by itself, causing a 'bigger' event.
			** This triggers a resize scale up, which adds a column, that doesn't fit, causing a resize down.
			** = endless loop.
			** Since 'disableColumn' doesn't send any parameters to 'updateWidths', we can check for an event
			** parameter = not caused by 'disableColumn' but rather 'enableColumn' or actual resize.
			*/
			bigger = body.clientWidth > this._previousWidth && event;
			this._previousWidth = body.clientWidth;
			/**
			* To prevent infinite loops by multiple events, we need to check for 'bigger' events first
			* to avoid triggering a 'disableColumn' action in the upscaling process.
			*
			* Also make sure that the body is not overflowing (fits), when receiving multiple resize up
			* events during a "scale up", we can hit an async infinite loop otherwise.
			*
			* Finally, there's no point in trying to enable a header if there aren't any disabled ones,
			* but we don't want to return since this event might be the final one - actually updating
			* column widths.
			*/
			if (fits && bigger && this.disabledHeaders.length > 0) {
				/**
				 * Only scale up if:
				 * * It's the first scale up step - a native 'resize' event without detail.second
				 * * it's the second scale up step - scalingup set by first event and detail.second
				 */
				/**
				 * Make sure to sync scalingUp and detail.second since a mismatch can occur if a
				 * 'resize' triggers a scalingUp process that hasn't completed.
				 */
				if (this.scalingUp === second) {
					this.enableColumn();
				}
				/**
				 * Discard any 'resize'-up events until the scale up is completed.
				 */
				return;
			}
			/**
			* Reset scale-up status as soon as a non-'bigger' event occurs.
			*/
			this.scalingUp = false;
			if (!fits && visibleColumns > 1) {
				this.async(this.disableColumn);
				return;
			}

			widthSetter = groupedList.$$('template-selector:not([hidden]) .item:not([style])');

			if (widthSetter === null) {
				return;
			}
			headerTds = Polymer.dom(this.$.header).querySelectorAll('.header');
			widthTds = Polymer.dom(widthSetter).querySelectorAll('.cell');
			widthTds.forEach(function (element, index) {
				var headerElement = headerTds[index],
					csElement = window.getComputedStyle(element, null),
					newWidth = element.clientWidth - parseInt(csElement.getPropertyValue('padding-left'), 10) - parseInt(csElement.getPropertyValue('padding-right'), 10);
				headerElement.style.width = newWidth + 'px';
				headerElement.style.maxWidth = newWidth + 'px';
			});
		},
		renderLink: function (header, model) {
			var link;
			if (!header || !model) {
				return '';
			}
			if (!header.linkbase || !header.linkprop) {
				return '#!/invalid/link';
			}
			if (header.linkbase[0] === '#') {
				// static url
				link = header.linkbase;
			} else {
				link = this.resolveProp(model, header.linkbase);
			}
			return link + this.resolveProp(model, header.linkprop);
		},
		//TODO: Use cosmoz-behaviors
		/**
		 * Helper method for Polymer 1.0+ templates - check if variable
		 * is undefined, null, empty Array list or empty String.
		 * @param  {Object}  obj variable
		 * @return {Boolean}  true if "empty", false otherwise
		 * @memberOf element/cz-omnitable
		 */
		isEmpty: function (obj) {
			if (obj === undefined || obj === null) {
				return true;
			}
			if (obj instanceof Array && obj.length === 0) {
				return true;
			}
			var objType = typeof obj;
			if (objType === 'string' && obj.length === 0) {
				return true;
			}
			if (objType === 'number' && obj === 0) {
				return true;
			}
			return false;
		},
		//TODO: Use cosmoz-behaviors
		/**
		 * Resolve a JS object path to its property value
		 * @param  {Object} item The JS object
		 * @param  {String} path The (recursive) object property such as "counterParty.name"
		 * @return {mixed}      The value of the object property
		 * @memberOf element/cz-omnitable
		 */
		resolveProp: function (item, path) {
			if (item === undefined || path === undefined) {
				return '';
			}
			// TODO: Cleaner solution ?
			if (item.placeholder && Object.keys(item).length === 1) {
				return '';
			}
			if (item.hasOwnProperty(path)) {
				return item[path];
			}
			var firstDotIndex = path.indexOf('.'), firstProp, restOfPropPath;
			if (firstDotIndex > 0) {
				firstProp = path.substring(0, firstDotIndex);
				restOfPropPath = path.substring(firstDotIndex + 1);
				return this.resolveProp(item[firstProp], restOfPropPath);
			}
			console.warn('item does not have property/path', item, path);
			return '';
		},

		_computeClasses: function (type, headerType, index) {
			return [
				type,
				'c' + index,
				'type-' + headerType
			].join(' ');
		},

		_computeHeaderClasses: function (headerType, index) {
			return [
				'header',
				'c' + index,
				'header-type-' + headerType
			].join(' ');
		},

		_computeItemClasses: function (item, expanded, disabledHeadersCount) {
			var	classes = [
				'item'
			];

			if (disabledHeadersCount > 0) {
				classes.push('expandable');
			}

			if (expanded) {
				classes.push('expanded');
			}

			return classes.join(' ');
		},

		_computeItemRowClasses: function (change) {
			var
				item = change.base,
				classes = [
					'item-row'
				];

			if (item.checked) {
				classes.push('selected');
			}
			if (item.placeholder) {
				classes.push('width-setter');
			}
			return classes.join(' ');
		},

		// TODO: Generalize into behavior, more args
		_allTrue: function (arg1, arg2) {
			return arg1 && arg2;
		},

		_onWebWorkerReady: function () {
			this._webWorkerReady = true;
			if (this._needs.filtering) {
				this.filterKick += 1;
			}
		}
	});
}());