import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import Home from "./pages/Home";
import ProblemSolver from "./pages/ProblemSolver";
import ProblemReview from "./pages/ProblemReview";
import Feedback from "./pages/Feedback";
import SupportMe from "./pages/SupportMe";

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

        <Route
          path="/feedback"
          element={<Feedback />}
        />

        <Route
          path="/support"
          element={<SupportMe />}
        />

      </Routes>

    </BrowserRouter>

  );

}

export default App;