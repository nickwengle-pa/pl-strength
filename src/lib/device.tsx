import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Viewport = "mobile" | "tablet" | "desktop";

export type DeviceInfo = {
  width: number;
  height: number;
  viewport: Viewport;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
};

const FALLBACK_STATE: DeviceInfo = {
  width: 1024,
  height: 768,
  viewport: "desktop",
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isTouch: false,
};

const DeviceContext = createContext<DeviceInfo>(FALLBACK_STATE);

const getViewport = (width: number): Viewport => {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
};

const computeDeviceInfo = (): DeviceInfo => {
  if (typeof window === "undefined") {
    return FALLBACK_STATE;
  }

  const width = window.innerWidth || FALLBACK_STATE.width;
  const height = window.innerHeight || FALLBACK_STATE.height;
  const viewport = getViewport(width);
  const isTouch =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;

  return {
    width,
    height,
    viewport,
    isMobile: viewport === "mobile",
    isTablet: viewport === "tablet",
    isDesktop: viewport === "desktop",
    isTouch,
  };
};

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<DeviceInfo>(() => computeDeviceInfo());

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    const handleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setDevice(computeDeviceInfo());
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const value = useMemo(() => device, [device]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceInfo {
  return useContext(DeviceContext);
}

export function useResponsiveValue<T>(
  values: {
    mobile?: T;
    tablet?: T;
    desktop?: T;
    default: T;
  }
): T {
  const device = useDevice();
  if (device.isMobile && "mobile" in values && values.mobile !== undefined) {
    return values.mobile;
  }
  if (device.isTablet && "tablet" in values && values.tablet !== undefined) {
    return values.tablet;
  }
  if (device.isDesktop && "desktop" in values && values.desktop !== undefined) {
    return values.desktop;
  }
  return values.default;
}

