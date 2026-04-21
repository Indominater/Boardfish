self.onmessage = (e) => {
  self.postMessage(JSON.stringify(e.data));
};
