import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { TranslateEditor } from "./translate.tsx";

test("TranslateEditor multiline paste, emoji boundary deletion, Enter newline, and Ctrl+Enter submit", async () => {
  let submittedCount = 0;
  let submittedText = "";

  const setup = await testRender(
    () => (
      <TranslateEditor
        focused={true}
        onSubmit={(text) => {
          submittedCount++;
          submittedText = text;
        }}
      />
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  );

  try {
    await setup.renderOnce();

    // 1. Bracketed paste with multiline text containing Korean and emoji: `한글🙂\n두 번째 줄`
    await setup.mockInput.pasteBracketedText("한글🙂\n두 번째 줄");
    await setup.renderOnce();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("한글🙂");
    expect(frame).toContain("두 번째 줄");

    // 2. Insert emoji and delete it directly at its boundary with backspace
    // Confirm the multi-byte emoji is deleted cleanly without leaving corrupt UTF-16 surrogates
    await setup.mockInput.pasteBracketedText("🎉");
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("🎉");

    setup.mockInput.pressBackspace();
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("🎉");
    // Ensure the preceding text remained intact and uncorrupted
    expect(frame).toContain("두 번째 줄");

    // 3. Plain Enter adds a newline without submitting
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(submittedCount).toBe(0);

    // 4. Shortcut letters (c, a, q, and Korean ㅊ) remain input in editor mode and do not trigger actions
    await setup.mockInput.typeText("caqㅊ");
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("caqㅊ");
    expect(submittedCount).toBe(0);

    // 5. Ctrl+Enter submits exactly once with the exact edited Unicode payload
    setup.mockInput.pressEnter({ ctrl: true });
    await setup.renderOnce();

    await setup.waitFor(() => submittedCount === 1);
    expect(submittedCount).toBe(1);
    expect(submittedText).toBe("한글🙂\n두 번째 줄\ncaqㅊ");

    setup.mockInput.pressEnter({ super: true });
    await setup.renderOnce();
    await setup.waitFor(() => submittedCount === 2);
    expect(submittedCount).toBe(2);
    expect(submittedText).toBe("한글🙂\n두 번째 줄\ncaqㅊ");
  } finally {
    setup.renderer.destroy();
  }
});
