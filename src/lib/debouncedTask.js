export function createDebouncedTask(task, delay = 350) {
  let timer = null;

  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        task();
      }, delay);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
