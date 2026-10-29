// Chrome serializes this function into the recorded tab's isolated world.
// Keep every helper inside the function; page code cannot access this state.
export function scrollPage(command) {
  const key = "__pageRecorderSmoothScroll";
  let controller = globalThis[key];
  if (command.action === "cancel") {
    if (controller?.sessionId === command.sessionId) controller.cancel();
    return { running: Boolean(globalThis[key]), queued: globalThis[key]?.queue.length || 0 };
  }
  const point = command.action === "point" && Number.isFinite(command.top) && command.top >= 0;
  if (!point && (command.action !== "step" || ![1, -1].includes(command.direction))) {
    throw new Error("Invalid scroll command.");
  }
  if (controller?.sessionId !== command.sessionId) {
    controller?.cancel();
    controller = null;
  }
  if (point && controller && !controller.isRoot) { controller.cancel(); controller = null; }
  const step = { direction: command.direction, ...command.settings, ...(point ? { top: command.top } : {}) };
  if (controller) {
    controller.queue.push(step);
    return { running: true, queued: controller.queue.length };
  }

  const view = window;
  const doc = document;
  const viewportHeight = view.innerHeight ?? innerHeight;
  const viewportWidth = view.innerWidth ?? innerWidth;
  const root = doc.scrollingElement || doc.documentElement;
  if (!root) return { running: false, queued: 0 };
  let target = root;
  // Some applications scroll a large inner panel instead of the document.
  if (!point && root.scrollHeight <= root.clientHeight + 1) {
    let largestVisibleArea = 0;
    for (const element of doc.querySelectorAll("body *")) {
      if (element.scrollHeight <= element.clientHeight + 1 || element.clientHeight < 1) continue;
      if (!/^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY)) continue;
      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(viewportWidth, rect.right) - Math.max(0, rect.left));
      const visibleHeight = Math.max(0, Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top));
      const area = visibleWidth * visibleHeight;
      if (area > largestVisibleArea) {
        target = element;
        largestVisibleArea = area;
      }
    }
  }

  const savedStyles = ["scroll-behavior", "scroll-snap-type", "overflow-anchor"].map(property => ({
    property, value: target.style.getPropertyValue(property), priority: target.style.getPropertyPriority(property),
  }));
  target.style.setProperty("scroll-behavior", "auto", "important");
  target.style.setProperty("scroll-snap-type", "none", "important");
  target.style.setProperty("overflow-anchor", "none", "important");

  let frameId = null;
  let cancelled = false;
  const queue = [step];
  function cleanup() {
    if (cancelled) return;
    cancelled = true;
    if (frameId != null) cancelAnimationFrame(frameId);
    queue.length = 0;
    for (const { property, value, priority } of savedStyles) {
      if (value) target.style.setProperty(property, value, priority);
      else target.style.removeProperty(property);
    }
    view.removeEventListener("pagehide", cleanup);
    if (globalThis[key] === controller) delete globalThis[key];
  }
  controller = { sessionId: command.sessionId, queue, cancel: cleanup, isRoot: target === root };
  globalThis[key] = controller;
  view.addEventListener("pagehide", cleanup, { once: true });

  function eased(progress, easing) {
    switch (easing) {
      case "linear": return progress;
      case "ease-out-cubic": return 1 - (1 - progress) ** 3;
      case "ease-in-out-sine": return (1 - Math.cos(Math.PI * progress)) / 2;
      default: return progress ** 3 * (progress * (progress * 6 - 15) + 10);
    }
  }
  function maxScroll() { return Math.max(0, target.scrollHeight - target.clientHeight); }
  function setScroll(top) {
    const position = { top: Math.max(0, Math.min(maxScroll(), top)), left: target.scrollLeft, behavior: "instant" };
    if (target === root) view.scrollTo(position);
    else target.scrollTo(position);
  }
  function next() {
    if (cancelled) return;
    if (target.isConnected === false) return cleanup();
    const current = queue.shift();
    if (!current) return cleanup();
    const from = target.scrollTop;
    const to = Math.max(0, Math.min(maxScroll(), Number.isFinite(current.top) ? current.top : from + current.direction * viewportHeight * current.stepPercent / 100));
    if (Math.abs(to - from) < 0.01) {
      // Consume boundary presses without recursion or an extra animation.
      frameId = requestAnimationFrame(next);
      return;
    }
    const start = performance.now();
    function frame(now) {
      if (cancelled) return;
      if (target.isConnected === false) return cleanup();
      const progress = Math.max(0, Math.min(1, (now - start) / current.durationMs));
      setScroll(from + (to - from) * eased(progress, current.easing));
      if (progress < 1) frameId = requestAnimationFrame(frame);
      else next();
    }
    frameId = requestAnimationFrame(frame);
  }
  next();
  return { running: !cancelled, queued: queue.length };
}
