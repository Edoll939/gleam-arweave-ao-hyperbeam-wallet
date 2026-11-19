import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ArmingLabel, InputArmedContext } from "./ArmingLabel";

afterEach(() => {
  cleanup();
});

describe("ArmingLabel", () => {
  it("shows a spinner, keeping the label as the button's name, until clicks count", () => {
    const { container } = render(
      <InputArmedContext.Provider value={false}>
        <button type="button">
          <ArmingLabel>Sign</ArmingLabel>
        </button>
      </InputArmedContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Sign" })).toBeTruthy();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("is the plain label once armed, and outside an approval", () => {
    const { container } = render(
      <button type="button">
        <ArmingLabel>Send</ArmingLabel>
      </button>,
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
