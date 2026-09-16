import {
  useEffect,
  useRef,
} from "react";

import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";


// =====================================
// CODE EDITOR
// =====================================
//
// CodeMirror 6 with Python highlighting, line numbers, bracket
// matching and auto-indent.
//
// The editor is uncontrolled on purpose. Rebuilding its state from a
// `value` prop on every keystroke would fight the user's cursor and
// undo history, so the document lives in CodeMirror and changes are
// pushed out through onChange.

export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
}) {

  const hostRef = useRef(null);
  const viewRef = useRef(null);

  // Held in a ref so the effect below never needs onChange as a
  // dependency - the editor must not be torn down when the parent
  // re-renders with a new closure.
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);


  useEffect(() => {

    if (!hostRef.current) {
      return;
    }


    const view = new EditorView({

      state: EditorState.create({

        doc: value ?? "",

        extensions: [

          basicSetup,

          python(),

          oneDark,

          // Tab indents instead of moving focus. Trapping Tab hurts
          // keyboard navigation, but in a code editor it is what
          // every user expects; Escape then Tab still escapes.
          keymap.of([indentWithTab]),

          EditorView.updateListener.of((update) => {

            if (update.docChanged) {

              onChangeRef.current?.(
                update.state.doc.toString()
              );

            }

          }),

          EditorState.readOnly.of(readOnly),

          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
            },
            ".cm-scroller": {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              lineHeight: "1.6",
            },
          }),

        ],

      }),

      parent: hostRef.current,

    });


    viewRef.current = view;


    return () => {
      view.destroy();
      viewRef.current = null;
    };

    // Mount once. `value` is the initial document only; later syncing
    // is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);


  // =====================================
  // EXTERNAL VALUE CHANGES
  // =====================================
  //
  // Only applies when the incoming value genuinely differs from what
  // the editor already holds, so typing is never disturbed. This is
  // what makes "Reset code" work.

  useEffect(() => {

    const view = viewRef.current;

    if (!view) {
      return;
    }

    const current = view.state.doc.toString();

    if (value !== undefined && value !== current) {

      view.dispatch({
        changes: {
          from: 0,
          to: current.length,
          insert: value,
        },
      });

    }

  }, [value]);


  return (
    <div
      ref={hostRef}
      style={{
        height: "100%",
        overflow: "hidden",
      }}
    />
  );

}
