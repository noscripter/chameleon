/*!
 * Chameleon
 *
 * Copyright 2014 ghostwords.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 */

/*
 * Injected via inject.js. Not a content script, no chrome.* API access.
 */

(function () {

	Error.stackTraceLimit = Infinity; // collect all frames

	var event_id = document.currentScript.getAttribute('data-event-id');

	// from underscore-1.6.0.js
	function debounce(func, wait, immediate) {
		var timeout, args, context, timestamp, result;

		var later = function () {
			var last = Date.now() - timestamp;
			if (last < wait) {
				timeout = setTimeout(later, wait - last);
			} else {
				timeout = null;
				if (!immediate) {
					result = func.apply(context, args);
					context = args = null;
				}
			}
		};

		return function () {
			context = this;
			args = arguments;
			timestamp = Date.now();
			var callNow = immediate && !timeout;
			if (!timeout) {
				timeout = setTimeout(later, wait);
			}
			if (callNow) {
				result = func.apply(context, args);
				context = args = null;
			}

			return result;
		};
	}

	// messages the injected script
	var send = (function () {
		var messages = [];

		// debounce sending queued messages
		var _send = debounce(function () {
			document.dispatchEvent(new CustomEvent(event_id, {
				detail: messages
			}));

			// clear the queue
			messages = [];
		}, 100);

		return function (msg) {
			// queue the message
			messages.push(msg);

			_send();
		};
	}());

	// http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
	function getStackTrace(structured) {
		var err = {}, // TODO should this be new Error() instead?
			origFormatter,
			stack;

		if (structured) {
			origFormatter = Error.prepareStackTrace;
			Error.prepareStackTrace = function (err, structuredStackTrace) {
				return structuredStackTrace;
			};
		}

		Error.captureStackTrace(err, getStackTrace);
		stack = err.stack;

		if (structured) {
			Error.prepareStackTrace = origFormatter;
		}

		return stack;
	}

	/*
	TODO Doesn't work when the stack trace contains <anonymous> fileNames.
	For example: http://blogs.wsj.com/digits/2014/07/16/newest-hit-game-maker-machine-zone-nears-3-billion-valuation/
		at Navigator.Object.defineProperty.get [as userAgent] (chrome-extension://.../js/builds/injected.min.js:2:1027)
		at Object.self.doTag (<anonymous>:33:1230)
		at bk_doSendData (<anonymous>:33:2259)
		at Object.blueKai.blueKai.sendBlueKai (<anonymous>:55:3)
		at Object.blueKai.blueKai.getAdsData (<anonymous>:147:8)
		at <anonymous>:1:17
	Seems related to setTimeout use.

	TODO Doesn't work when the script gets loaded via eval.
	For example, see globalEval in http://code.jquery.com/jquery-1.6.4.js,
	used on http://fingerprint.pet-portal.eu/, apparently here:
		$.get("?controller=fingerprint&t="+(new Date().getTime()), function(data) {
			$('body').append(data);
		});
	The stack trace:
		at Navigator.Object.defineProperty.get [as language] (chrome-extension://.../js/builds/injected.min.js:2:1020)
		at start_test (eval at <anonymous> (eval at <anonymous> (http://fingerprint.pet-portal.eu/javascript/jquery.min.js:2:12388)), <anonymous>:1:1079)
	Appears to be double eval'd: once by jQuery and again by Dean Edwards' Packer.
	Another eval'd script example here: http://lomavistarecordings.com/
	*/
	function getOriginatingScriptUrl() {
		// this script is at 0 and 1
		var callSite = getStackTrace(true)[2];

		if (callSite.isEval()) {
			// argh, getEvalOrigin returns a string ...
			return callSite.getEvalOrigin().match(/\((http.*)\)$/)[1];
		} else {
			return callSite.getFileName() + ':' + callSite.getLineNumber() + ':' + callSite.getColumnNumber();
		}
	}

	function stripLineAndColumnNumbers(script_url) {
		return script_url.replace(/:\d+:\d+$/, '');
	}

	function getObjectName(o) {
		return o.toString().replace(/^\[object ([^\]]+)\]/, '$1');
	}

	function trap(obj, prop, override) {
		var desc = Object.getOwnPropertyDescriptor(obj, prop);

		if (desc && !desc.configurable) {
			console.log("%s.%s is not configurable", obj, prop);
			return;
		}

		var orig_val = obj[prop];

		//if (orig_val == console || orig_val == console.log) {
		//	return;
		//}

		//console.log("trapping %s.%s ...", obj, prop);

		Object.defineProperty(obj, prop, {
			get: function () {
				var script_url = getOriginatingScriptUrl();

				console.log("%s.%s prop access: %s", obj, prop, script_url);

				send({
					obj: getObjectName(obj),
					prop: prop.toString(),
					scriptUrl: stripLineAndColumnNumbers(script_url)
				});

				if (override !== undefined) {
					return override;
				}

				return orig_val;
			}
		});
	}

	// define nonexistent-in-Chrome properties (to match Tor Browser)
	// TODO merge into trap()
	window.navigator.buildID = "20000101000000";
	window.navigator.oscpu = "Windows NT 6.1";

	// JS objects to trap along with properties to override
	[
		{
			obj: window.navigator,
			overrides: {
				appCodeName: "Mozilla",
				appName: "Netscape",
				appVersion: "5.0 (Windows)",
				doNotTrack: "unspecified",
				// TODO not overridable?
				//javaEnabled: function () {
				//	return false;
				//},
				language: "en-US",
				mimeTypes: {
					length: 0
				},
				platform: "Win32",
				plugins: {
					length: 0,
					refresh: function () {}
				},
				userAgent: "Mozilla/5.0 (Windows NT 6.1; rv:24.0) Gecko/20100101 Firefox/24.0",
				vendor: ""
			}
		},
		{
			obj: window.screen,
			overrides: {
				availWidth: 1000,
				availHeight: 700,
				width: 1000,
				height: 700,
				colorDepth: 24
			}
		}
	].forEach(function (item) {
		Object.keys(item.obj).forEach(function (prop) {
			trap(item.obj, prop, item.overrides[prop]);
		});
	});
	trap(window, 'innerWidth', 1000);
	trap(window, 'innerHeight', 700);

	// override instance methods
	// override Date
	// TODO merge into trap()
	window.Date.prototype.getTimezoneOffset = function () {
		var script_url = getOriginatingScriptUrl();

		console.log("Date.prototype.getTimezoneOffset prop access: %s", script_url);

		send({
			obj: 'Date.prototype',
			prop: 'getTimezoneOffset',
			scriptUrl: stripLineAndColumnNumbers(script_url)
		});

		return 0;
	};
	// TODO Tor also changes the time to match timezone 0 (getHours(), etc.)

	// handle canvas-based fingerprinting
	HTMLCanvasElement.prototype.toDataURL = (function (orig) {
		// TODO merge into trap()
		return function () {
			var script_url = getOriginatingScriptUrl();

			console.log("HTMLCanvasElement.prototype.toDataURL prop access: %s", script_url);

			send({
				obj: 'HTMLCanvasElement.prototype',
				prop: 'toDataURL',
				scriptUrl: stripLineAndColumnNumbers(script_url)
			});

			// TODO detection only for now ... to protect, need to generate an
			// TODO empty canvas with matching dimensions, but Chrome and
			// TODO Firefox produce different PNGs from same inputs somehow
			//c.setAttribute('width', this.width);
			//c.setAttribute('height', this.height);

			return orig.apply(this, arguments);
		};
	}(HTMLCanvasElement.prototype.toDataURL));

	// detect font enumeration
	var observer = new MutationObserver(function (mutations) {
		for (var i = 0; i < mutations.length; i++) {
			var mutation = mutations[i];

			if (!mutation.oldValue || mutation.oldValue.indexOf('font-family: ') == -1) {
				continue;
			}

			var target = mutation.target,
				old_font = mutation.oldValue.match(/font-family: ([^;]+);/)[1],
				fonts = [];

			// TODO switch to WeakMaps
			// TODO https://github.com/Benvie/WeakMap
			// TODO https://gist.github.com/Gozala/1269991
			if (!(event_id in target.dataset)) {
				target.dataset[event_id] = '';
			} else {
				fonts = target.dataset[event_id].split(';');
			}

			if (fonts.indexOf(old_font) == -1) {
				fonts.push(old_font);
			}

			console.log(fonts); // TODO

			if (fonts.length > 2) {
				console.log(mutation); // TODO

				// TODO since MutationObserver is async, a stack trace now
				// TODO won't get us the script that originated the scanning
				send({
					obj: getObjectName(target),
					prop: 'style.fontFamily'
				});

				// no need to keep listening
				observer.disconnect();

				break;
			}

			target.dataset[event_id] = fonts.join(';');
		}
	});
	observer.observe(document, {
		attribute: true,
		// TODO more precise filtering?
		attributeFilter: ['style'],
		attributeOldValue: true,
		childList: false,
		subtree: true
	});

}());
