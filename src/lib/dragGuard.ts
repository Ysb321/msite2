/** Drag-vs-click guard: after a carousel drag ends, ignore the click that
 *  fires on release so dragging never navigates to a title. */
let dragEndTs = 0;

export const markDragEnd = () => {
  dragEndTs = performance.now();
};

export const wasRecentlyDragged = () => performance.now() - dragEndTs < 180;
