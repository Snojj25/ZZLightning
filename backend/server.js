const { app } = require("./app");
const port = 4000; // process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
