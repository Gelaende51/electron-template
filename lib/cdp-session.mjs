/**
 * One long-lived Chrome DevTools Protocol session with an Electron app's
 * window, for test suites: evaluate in the page (awaiting its promises), real
 * key presses, a stuck-page diagnosis, a slowness factor. From Lure
 * (.dev/cdpSession.mjs); app-specific window choice and pre-flight checks are
 * passed in.
 *
 *   import { connect, pressKey, PAUSE } from "electron-template/cdp-session";
 *   const page = await connect({ pickTarget: (pages) => pages.find(...) });
 *
 * Start the app with --remote-debugging-port=<CDP_PORT> (default 9222).
 */

const PORT = process.env.CDP_PORT ?? process.env.OBSIDIAN_CDP_PORT ?? 9222;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** How much slower than a CI runner this machine is meant to be: SLOW=3 triples every wait. */
export const SLOW = Math.max(1, Number(process.env.SLOW ?? process.env.LURE_SLOW) || 1);

/**
 * Window titles arrive HTML-escaped (Obsidian does it), so a window named
 * "L'Éclaire, c'est moi" reads "L&#39;Éclaire, c&#39;est moi" and a literal
 * comparison never matches. Decode before comparing.
 */
export function decodeTitle(title) {
	return title
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** The one page target there is, or the one whose title contains WINDOW. */
function defaultPick(pages) {
	const named = process.env.WINDOW;
	if (named) return pages.find((t) => decodeTitle(t.title).includes(named));
	if (pages.length > 1) {
		throw new Error(`${pages.length} windows are open, so the target is ambiguous:\n  ${pages.map((t) => decodeTitle(t.title)).join("\n  ")}\nSet WINDOW=<part of its title>.`);
	}
	return pages[0];
}

/**
 * Connects to the app's window. `pickTarget(pages)` chooses among the page
 * targets (devtools excluded) and may throw with a reason; `check(evaluate)`
 * runs once connected and returns a reason to refuse the window (e.g. a
 * dialog in front of it), or nothing.
 */
export async function connect({ pickTarget = defaultPick, check } = {}) {
	const targets = await (await fetch(`${ORIGIN}/json/list`)).json();
	const pages = targets.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
	if (!pages.length) throw new Error("No page target — is the app open with --remote-debugging-port?");
	const page = pickTarget(pages);
	if (!page) throw new Error(`No matching window. Open windows:\n  ${pages.map((t) => decodeTitle(t.title)).join("\n  ")}`);

	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
	});

	let nextId = 1;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.method === "Debugger.paused") onPaused?.(message.params);
		const settle = pending.get(message.id);
		if (!settle) return;
		pending.delete(message.id);
		if (message.error) settle.reject(new Error(message.error.message));
		else settle.resolve(message.result);
	});

	// Input events get a deadline of their own: one that is never answered
	// (macOS has done this to a Cmd+letter) fails the case it belongs to
	// instead of holding the whole job until the runner gives up on it.
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
			if (method.startsWith("Input.")) {
				setTimeout(() => {
					if (!pending.delete(id)) return;
					reject(new Error(`${method} was not answered within 10 s`));
				}, 10000);
			}
		});

	// The first time the page stops answering, where it is: the debugger can
	// still stop a script that loops, and a pause that never comes says the
	// page is blocked outside JavaScript (a sync call into the main process).
	let onPaused = null;
	let sampled = false;
	const sampleStack = async () => {
		if (sampled) return;
		sampled = true;
		const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
		const paused = new Promise((resolve) => (onPaused = resolve));
		await within(send("Debugger.enable").catch(() => null), 5000);
		await within(send("Debugger.pause").catch(() => null), 5000);
		const params = await within(paused, 5000);
		onPaused = null;
		if (!params) {
			console.log("    stuck page: the debugger could not pause it");
			return;
		}
		console.log("    stuck page, paused in:");
		for (const frame of params.callFrames.slice(0, 12)) {
			console.log(`      ${frame.functionName || "(anonymous)"}  ${(frame.url || "?").split("/").pop()}:${frame.location.lineNumber + 1}`);
		}
		await within(send("Debugger.resume").catch(() => null), 5000);
		await within(send("Debugger.disable").catch(() => null), 5000);
	};

	/**
	 * Evaluates in the page and returns the value. Expressions are wrapped
	 * in an async IIFE so a test step can await the app's own promises —
	 * opening a file, waiting for a debounce — inline.
	 */
	// SLOW stretches every wait for a machine that is slow on purpose —
	// an emulated build, a capped CPU — rather than lengthening them for all.
	const evaluate = async (expression, timeoutMs = 15000 * SLOW) => {
		// A step that never settles must fail its own test rather than wedge
		// the run — and a render heavy enough to kill the renderer outright
		// looks exactly like a step that never settles.
		const result = await Promise.race([
			send("Runtime.evaluate", {
				expression: `(async () => { ${expression} })()`,
				returnByValue: true,
				awaitPromise: true,
			}),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`page did not answer in ${timeoutMs}ms`)), timeoutMs),
			),
		]).catch(async (error) => {
			if (error.message.startsWith("page did not answer")) await sampleStack();
			throw error;
		});
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? "threw in page");
		}
		return result.result.value;
	};

	if (check) {
		const refusal = await check(evaluate);
		if (refusal) {
			socket.close();
			throw new Error(refusal);
		}
	}

	const session = { send, evaluate, close: () => socket.close() };
	globalThis.__harnessSession = session; // for development-template's failure screenshots
	return session;
}

/**
 * A real key press, dispatched by the browser rather than synthesised in the
 * page.
 *
 * An event made with `new KeyboardEvent(...)` is `isTrusted: false`, and
 * the app may decide what reaches a command (Obsidian does) from a capture-phase window
 * listener with a scope stack on top of it — so a synthetic event tests the
 * listener under it rather than the path a user takes. It is the difference
 * between the two that found a rename-dialog bug in Lure: `executeCommandById`
 * reported the plugin stealing focus, while a real key showed the command
 * never running at all.
 */
/**
 * keyCode, DOM code, and the text the key produces.
 *
 * The text matters more than it looks. A key sent as `rawKeyDown` with no
 * text never reaches the focused element for Enter and Tab — the event
 * arrives at the window and stops there, so a field's own keydown handler
 * never runs and the test reports the feature broken. Enter carries a
 * carriage return and Tab a tab; the genuinely textless keys (Escape,
 * arrows, function keys) carry nothing and are dispatched as raw.
 */
const KEY_CODES = {
	Escape: [27, "Escape", ""], Enter: [13, "Enter", "\r"], Tab: [9, "Tab", "\t"],
	Backspace: [8, "Backspace", ""], Delete: [46, "Delete", ""], Space: [32, "Space", " "],
	ArrowUp: [38, "ArrowUp", ""], ArrowDown: [40, "ArrowDown", ""],
	ArrowLeft: [37, "ArrowLeft", ""], ArrowRight: [39, "ArrowRight", ""],
	Home: [36, "Home", ""], End: [35, "End", ""],
	PageUp: [33, "PageUp", ""], PageDown: [34, "PageDown", ""],
	// The key itself, pressed alone.
	Alt: [18, "AltLeft", ""],
};

const MODIFIER_BITS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

/** "ctrl+shift+f2" -> the CDP payload for one press. */
/** Keys a word-wise "ctrl" moves over, which macOS moves over with Alt instead. */
const WORD_KEYS = new Set(["ArrowLeft", "ArrowRight", "Backspace", "Delete"]);

export function describeKey(spec) {
	const parts = spec.split("+");
	const name = parts.pop();
	let modifiers = 0;
	for (const raw of parts) {
		// Suites are written where Ctrl is the app's Mod. On macOS Mod is
		// Cmd, and a word at a time is Alt — so "ctrl" is read the way the
		// press is meant there. Ctrl+Tab stays Ctrl on every system.
		let part = raw.toLowerCase();
		if (process.platform === "darwin" && (part === "ctrl" || part === "control") && name !== "Tab") {
			part = WORD_KEYS.has(name) ? "alt" : "meta";
		}
		const bit = MODIFIER_BITS[part];
		if (!bit) throw new Error(`unknown modifier "${part}" in "${spec}"`);
		modifiers |= bit;
	}

	const fn = /^[fF](\d{1,2})$/.exec(name);
	if (fn) {
		const n = Number(fn[1]);
		if (n < 1 || n > 12) throw new Error(`no such function key "${name}"`);
		return { key: `F${n}`, code: `F${n}`, keyCode: 111 + n, modifiers, text: "" };
	}
	if (KEY_CODES[name]) {
		const [keyCode, code, text] = KEY_CODES[name];
		return { key: name === "Space" ? " " : name, code, keyCode, modifiers, text };
	}
	if (name.length === 1) {
		const upper = name.toUpperCase();
		const code = /[0-9]/.test(name) ? `Digit${name}` : `Key${upper}`;
		// A modified press produces no text: ctrl+l must not also type an "l".
		return { key: name, code, keyCode: upper.charCodeAt(0), modifiers, text: modifiers ? "" : name };
	}
	throw new Error(`don't know how to press "${name}"`);
}

/** Presses a key in a connected page. Accepts the same specs as describeKey. */
/**
 * On macOS a Cmd+letter is the menu's to answer, not the page's: delivered
 * bare it either does nothing or never comes back. Naming the editing
 * command with the press is how the debugger asks for it (what Puppeteer
 * does on a Mac).
 */
const MAC_COMMANDS = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

export async function pressKey(page, spec) {
	const { key, code, keyCode, modifiers, text } = describeKey(spec);
	const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
	const command = process.platform === "darwin" && modifiers === 4 ? MAC_COMMANDS[key.toLowerCase()] : undefined;
	await page.send("Input.dispatchKeyEvent", {
		...base,
		type: text ? "keyDown" : "rawKeyDown",
		text,
		unmodifiedText: text,
		...(command ? { commands: [command] } : {}),
	});
	await page.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

/** Page-side sleep, for debounced saves and the app's own async repaints. */
// Stretched by SLOW with every other wait: a pause sized for a runner is
// too short where the machine is slow on purpose.
export const PAUSE = (ms) => `await new Promise((r) => setTimeout(r, ${Math.round(ms * SLOW)}));`;

/**
 * Moves the pointer out of the way, to the right edge halfway down, so that
 * nothing the suite measures is hovered. A screen corner is avoided on
 * purpose: on many desktops it is a hot corner, and driving the pointer into
 * one takes the window out of compositing.
 */
export async function parkPointer(page) {
	const size = JSON.parse(
		await page.evaluate(`return JSON.stringify([window.innerWidth, window.innerHeight]);`),
	);
	await page.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: Math.max(0, size[0] - 8),
		y: Math.round(size[1] / 2),
		buttons: 0,
	});
}

/**
 * Whether this window is actually compositing frames.
 *
 * Geometry assertions rest on layout having refitted, which often runs
 * from a `ResizeObserver` — which, like
 * `requestAnimationFrame`, is delivered in the rendering steps. A window that
 * Chromium has stopped painting delivers neither, so every measurement
 * describes a layout that was never refitted, and
 * the failures it produces are detailed, plausible and entirely fictional.
 *
 * The existing gates cannot see this. `document.visibilityState` reads
 * "visible", `document.hidden` is false and `document.hasFocus()` is true in
 * exactly this state — measured. Counting frames is the only question that
 * answers it: no frames in half a second means nothing measured here is worth
 * reporting.
 */
export async function isPainting(page) {
	const frames = await page.evaluate(`
		let frames = 0;
		const tick = () => { frames++; requestAnimationFrame(tick); };
		requestAnimationFrame(tick);
		await new Promise((r) => setTimeout(r, 500));
		return frames;
	`);
	return Number(frames) > 0;
}

/**
 * A machine path the way the suites were written to read one: `C:\\a\\b`
 * becomes `/C:/a/b`, so an assertion about where a path starts and ends holds
 * on Windows as on Linux. Anything that is not a string comes back as it is.
 */
export function asPosix(value) {
	return typeof value === "string" ? value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:") : value;
}
