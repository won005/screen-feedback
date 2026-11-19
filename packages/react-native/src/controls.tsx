import { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Path, Svg } from "react-native-svg";
import type { Point } from "./placement.js";

const paths = {
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  collapse: "m6 10 6 6 6-6",
  comment: "M20 11a7 7 0 0 1-7 7H8l-4 3v-6a7 7 0 0 1-1-4 7 7 0 0 1 7-7h3a7 7 0 0 1 7 7Z",
  edit: "m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  heart: "M20.8 8.3c0 5.2-8.8 9.8-8.8 9.8s-8.8-4.6-8.8-9.8A4.4 4.4 0 0 1 12 7.5a4.4 4.4 0 0 1 8.8.8Z",
  image: "M4 4h16v16H4zM4 16l4-4 4 4 3-3 5 5M15 8h.01",
  reopen: "M4 11a8 8 0 1 1 2 6M4 5v6h6",
  send: "M12 20V4m-6 6 6-6 6 6",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5",
} as const;

type IconName = keyof typeof paths;

export function Icon({ name, color = "#625b5b", size = 16 }: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[name]}
        fill="none"
        stroke={color}
        strokeWidth={name === "grip" ? 3.2 : 1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconButton({ name, label, onPress, color, background, disabled = false, selected, badge }: {
  name: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  background?: string;
  disabled?: boolean;
  selected?: boolean;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        background === undefined ? undefined : { backgroundColor: background },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Icon name={name} {...(color === undefined ? {} : { color })} />
      {!!badge && (
        <View style={[styles.badge, color === undefined ? undefined : { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function DragHandle({ label, position, move, onPress }: {
  label: string;
  position: Point;
  move: (point: Point) => void;
  onPress?: () => void;
}) {
  const latest = useRef({ position, move });
  latest.current = { position, move };
  const origin = useRef(position);
  const drag = useMemo(() => Gesture.Pan()
    .minDistance(4)
    .maxPointers(1)
    .cancelsTouchesInView(true)
    .runOnJS(true)
    .onStart(() => { origin.current = latest.current.position; })
    .onUpdate(({ translationX, translationY }) => {
      latest.current.move({ x: origin.current.x + translationX, y: origin.current.y + translationY });
    }), []);

  return (
    <GestureDetector gesture={drag} touchAction="none">
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          hitSlop={4}
          style={styles.handle}
        >
          <Icon name="comment" />
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityLabel={label}
          accessibilityActions={[
            { name: "moveUp", label: "위로 이동" },
            { name: "moveDown", label: "아래로 이동" },
            { name: "moveLeft", label: "왼쪽으로 이동" },
            { name: "moveRight", label: "오른쪽으로 이동" },
          ]}
          onAccessibilityAction={({ nativeEvent }) => {
            const offsets: Record<string, Point> = {
              moveUp: { x: 0, y: -32 }, moveDown: { x: 0, y: 32 },
              moveLeft: { x: -32, y: 0 }, moveRight: { x: 32, y: 0 },
            };
            const offset = offsets[nativeEvent.actionName];
            if (offset) move({ x: position.x + offset.x, y: position.y + offset.y });
          }}
          style={styles.handle}
        >
          <Icon name="grip" color="#847b7b" />
        </View>
      )}
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center",
  },
  handle: {
    width: 32, minHeight: 38, alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: 0, right: -3, minWidth: 14, height: 14, paddingHorizontal: 2,
    borderRadius: 7, backgroundColor: "#d92d39", alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 9, color: "#ffffff", fontWeight: "700" },
  dimmed: { opacity: 0.48 },
});
