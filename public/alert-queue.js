export function createAlertQueue({ show, hide, clear = () => {}, displayMs = 2000, exitMs = 380, schedule = setTimeout }) {
  const events = [];
  let active = false;

  function showNext() {
    if (!events.length) {
      active = false;
      return;
    }

    active = true;
    show(events.shift());
    schedule(() => {
      hide();
      schedule(() => {
        clear();
        active = false;
        showNext();
      }, exitMs);
    }, displayMs);
  }

  return {
    enqueue(event) {
      events.push(event);
      if (!active) showNext();
    },
    get pending() {
      return events.length;
    }
  };
}