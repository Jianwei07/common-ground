import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { CanvasPane } from "../src/components/canvas-pane";

const excalidraw = vi.hoisted(() => ({
  api: {
    getAppState: vi.fn(),
    getSceneElements: vi.fn(),
    updateScene: vi.fn(),
  },
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock("next/dynamic", () => ({
  default: () => function MockExcalidraw(props: { excalidrawAPI: (api: typeof excalidraw.api) => void }) {
    excalidraw.props = props as unknown as Record<string, unknown>;
    const { excalidrawAPI } = props;
    useEffect(() => excalidrawAPI(excalidraw.api), [excalidrawAPI]);
    return <div />;
  },
}));

const handlers = {
  onCanvasChange: vi.fn(),
  onEditLink: vi.fn(),
  onFocus: vi.fn(),
  onOpenLink: vi.fn(),
  onSelection: vi.fn(),
};

describe("CanvasPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    excalidraw.props = undefined;
  });

  it("does not echo a local scene through updateScene, but applies an external change", async () => {
    const appState = { gridSize: null };
    const rectangle = { id: "rectangle", type: "rectangle", version: 1, versionNonce: 7, width: 160, height: 90 };
    excalidraw.api.getAppState.mockReturnValue(appState);
    excalidraw.api.getSceneElements.mockReturnValue([rectangle]);

    const props = {
      canvas: { elements: [rectangle], appState },
      focused: false,
      isCollaborating: false,
      ...handlers,
      viewOnly: false,
    };
    const { rerender } = render(<CanvasPane {...props} />);
    await waitFor(() => {
      expect(excalidraw.props).toBeDefined();
    });

    expect(excalidraw.api.updateScene).not.toHaveBeenCalled();
    rerender(<CanvasPane {...props} canvas={{ elements: [{ ...rectangle }], appState: { ...appState } }} />);

    expect(excalidraw.api.updateScene).not.toHaveBeenCalled();

    const externalRectangle = { ...rectangle, version: 2, versionNonce: 8, width: 200 };
    rerender(<CanvasPane {...props} canvas={{ elements: [externalRectangle], appState }} />);

    expect(excalidraw.api.updateScene).toHaveBeenCalledWith({
      elements: [externalRectangle],
      appState,
    });
  });

  it("ignores initial and repeated local scenes", () => {
    const storedState = { gridSize: null };
    const appState = { ...storedState, selectedElementIds: {} };
    const rectangle = { id: "rectangle", type: "rectangle", version: 1, versionNonce: 7, width: 160, height: 90 };
    excalidraw.api.getAppState.mockReturnValue(appState);
    excalidraw.api.getSceneElements.mockReturnValue([rectangle]);
    render(<CanvasPane canvas={{ elements: [rectangle], appState: storedState }} focused={false} isCollaborating={false} {...handlers} viewOnly={false} />);

    const onChange = excalidraw.props?.onChange as (elements: ReadonlyArray<Record<string, unknown>>, state: typeof appState) => void;
    onChange([rectangle], appState);
    expect(handlers.onCanvasChange).not.toHaveBeenCalled();

    const resized = { ...rectangle, version: 2, width: 170 };
    onChange([resized], appState);
    onChange([resized], appState);

    expect(handlers.onCanvasChange).toHaveBeenCalledTimes(1);
  });

  it("shows timer, repository, and dismissible navigation help", () => {
    vi.useFakeTimers();
    excalidraw.api.getAppState.mockReturnValue({});
    excalidraw.api.getSceneElements.mockReturnValue([]);
    render(<CanvasPane canvas={{ elements: [], appState: {} }} focused={false} isCollaborating={false} {...handlers} viewOnly={false} />);

    expect(screen.getByLabelText("Open Common Ground on GitHub")).toHaveAttribute("href", "https://github.com/Jianwei07/common-ground");
    fireEvent.click(screen.getByLabelText("Start timer"));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText("Whiteboard timer")).toHaveTextContent("1:59");
    fireEvent.click(screen.getByLabelText("Reset timer"));
    expect(screen.getByLabelText("Whiteboard timer")).toHaveTextContent("2:00");
    fireEvent.click(screen.getByLabelText("Dismiss navigation help"));
    expect(screen.queryByLabelText("Whiteboard navigation help")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
