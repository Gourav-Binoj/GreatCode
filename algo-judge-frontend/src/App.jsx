import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import Home from "./pages/Home";
import ProblemSolver from "./pages/ProblemSolver";
import ProblemReview from "./pages/ProblemReview";

function App() {

  return (

    <BrowserRouter>

      <Routes>

        <Route
          path="/"
          element={<Home />}
        />

        <Route
          path="/problem/:id"
          element={<ProblemSolver />}
        />

        <Route
          path="/review-problem"
          element={<ProblemReview />}
        />

      </Routes>

    </BrowserRouter>

  );

}

export default App;