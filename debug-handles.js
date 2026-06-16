setInterval(() => {
  console.log(process._getActiveHandles());
  console.log(process._getActiveRequests());
}, 1000);
