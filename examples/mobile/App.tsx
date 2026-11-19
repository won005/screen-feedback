import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { createMemoryFeedbackStore } from "@won005/feedback-core";
import type { FeedbackAttachment } from "@won005/feedback-core";
import { FeedbackAnchor, FeedbackProvider, FeedbackSurface } from "@won005/feedback-react-native";

const people = [
  { id: "mina", name: "미나" },
  { id: "jun", name: "준" },
] as const;
const feedback = createMemoryFeedbackStore({ users: people, allowedUserIds: people.map(({ id }) => id) });
const adapters = { mina: feedback.forUser("mina"), jun: feedback.forUser("jun") };

type Account = keyof typeof adapters;
type Board = "today" | "next";
type Task = { id: string; title: string; note: string };
const tasks: Record<Board, Task[]> = {
  today: [
    { id: "brief", title: "전시 소개 글 읽기", note: "전시 기간과 관람 방법을 확인해 주세요." },
    { id: "invite", title: "초대장 초안 검토", note: "첫 페이지에 시간과 장소가 잘 보이는지 확인해 주세요." },
    { id: "calendar", title: "준비 일정 확인", note: "설치와 리허설 일정이 겹치는지 살펴봅니다." },
    { id: "labels", title: "작품 설명 문구 확인", note: "작가 이름과 작품명을 대조합니다." },
    { id: "route", title: "관람 동선 점검", note: "입구부터 전시장 가장 안쪽까지 확인합니다." },
    { id: "print", title: "안내문 인쇄 수량 정리", note: "입구와 안내 데스크에 비치할 수량을 더합니다." },
    { id: "staff", title: "당일 진행 순서 정리", note: "교대 시간과 담당자를 확인합니다." },
    { id: "followup", title: "참여자 설문 초안 확인", note: "작성 시간이 길지 않은지 점검합니다." },
  ],
  next: [
    { id: "wrap", title: "전시 회고 메모 준비", note: "관람객 의견과 다음에 바꿀 점을 정리합니다." },
    { id: "photos", title: "행사 사진 정리", note: "공유할 사진을 함께 고릅니다." },
  ],
};
let imageSequence = 0;

async function pickImages(remaining: number): Promise<FeedbackAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, remaining).map((image) => {
    imageSequence++;
    const extension = image.fileName?.split(".").pop()?.toLowerCase();
    const inferred = extension === "jpg" || extension === "jpeg" || !extension ? "jpeg" : extension;
    return {
      id: `sample-image-${imageSequence}`,
      name: image.fileName ?? `사진 ${imageSequence}`,
      url: image.uri,
      mimeType: image.mimeType === "image/jpg" ? "image/jpeg" : image.mimeType ?? `image/${inferred}`,
    };
  });
}

function TaskBoard() {
  const insets = useSafeAreaInsets();
  const [board, setBoard] = useState<Board>("today");
  const [account, setAccount] = useState<Account>("mina");
  const [activeTask, setActiveTask] = useState<Task>();
  const [completed, setCompleted] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  return (
    <FeedbackProvider
      adapter={adapters[account]}
      screen={{ id: "tasks", resourceId: board, version: "1" }}
      insets={insets}
      onPickImages={pickImages}
      onError={() => setFailed(true)}
      onNavigate={(notice) => {
        if (notice.screen.id !== "tasks") return;
        const target = notice.screen.resourceId;
        if (target === "today" || target === "next") {
          setActiveTask(undefined);
          setBoard(target);
        }
      }}
    >
      <View style={[styles.screen, { paddingTop: insets.top + 24 }]}>
        <View style={styles.header}>
          <Text style={styles.heading}>전시 준비</Text>
          <Text style={styles.description}>피드백을 켜고, 의견을 남길 곳을 길게 누르세요.</Text>
          <View style={styles.accountRow}>
            {people.map(({ id, name }) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: account === id }}
                onPress={() => {
                  setFailed(false);
                  setAccount(id);
                }}
                style={[styles.account, account === id && styles.selectedAccount]}
              >
                <Text style={styles.accountText}>{name}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.tabs}>
            {(["today", "next"] as const).map((id) => (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: board === id }}
                onPress={() => setBoard(id)}
                style={[styles.tab, board === id && styles.selectedTab]}
              >
                <Text style={styles.tabText}>{id === "today" ? "오늘" : "다음"}</Text>
              </Pressable>
            ))}
          </View>
          {failed && <Text accessibilityRole="alert" style={styles.error}>피드백 작업 중 문제가 발생했습니다.</Text>}
        </View>
        <FlatList
          data={tasks[board]}
          keyExtractor={({ id }) => id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const done = completed.includes(item.id);
            return (
              <FeedbackAnchor id={item.id} style={styles.card}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${item.title} 완료`}
                  accessibilityState={{ checked: done }}
                  onPress={() => setCompleted((current) => done
                    ? current.filter((id) => id !== item.id)
                    : [...current, item.id])}
                  style={[styles.checkbox, done && styles.checked]}
                />
                <Pressable accessibilityRole="button" onPress={() => setActiveTask(item)} style={styles.task}>
                  <Text style={styles.taskTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.taskNote}>{item.note}</Text>
                </Pressable>
              </FeedbackAnchor>
            );
          }}
        />
      </View>
      {activeTask && (
        <Modal
          visible animationType="slide" presentationStyle="fullScreen"
          onRequestClose={() => setActiveTask(undefined)}
        >
          <FeedbackSurface id="task-detail" style={styles.modal}>
            <View style={[styles.details, { paddingTop: insets.top + 20 }]}>
              <Pressable accessibilityRole="button" onPress={() => setActiveTask(undefined)} style={styles.back}>
                <Text style={styles.backText}>목록으로</Text>
              </Pressable>
              <FeedbackAnchor id={`detail-${activeTask.id}`} style={styles.detailCard}>
                <Text style={styles.heading}>{activeTask.title}</Text>
                <Text style={styles.description}>{activeTask.note}</Text>
              </FeedbackAnchor>
            </View>
          </FeedbackSurface>
        </Modal>
      )}
    </FeedbackProvider>
  );
}

export default function App() {
  return <SafeAreaProvider><TaskBoard /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3efe6" },
  header: { paddingHorizontal: 22 },
  heading: { color: "#211c16", fontSize: 27, fontWeight: "700" },
  description: { color: "#554b3b", fontSize: 14, lineHeight: 21, marginTop: 6 },
  accountRow: { flexDirection: "row", gap: 8, marginTop: 15 },
  account: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 15, borderWidth: 1, borderColor: "#c9c0ac" },
  selectedAccount: { backgroundColor: "#e3dcd0", borderColor: "#9b8b76" },
  accountText: { color: "#433829", fontSize: 12, fontWeight: "600" },
  tabs: { flexDirection: "row", gap: 18, marginTop: 14, borderBottomWidth: 1, borderColor: "#d5cabb" },
  tab: { paddingHorizontal: 2, paddingVertical: 9, borderBottomWidth: 2, borderColor: "transparent" },
  selectedTab: { borderColor: "#493f31" },
  tabText: { color: "#362d21", fontWeight: "700", fontSize: 13 },
  list: { padding: 14, paddingBottom: 88, gap: 8 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 64,
    borderRadius: 9, backgroundColor: "#fffdf7",
  },
  checkbox: { width: 23, height: 23, borderWidth: 1, borderColor: "#958975", borderRadius: 6 },
  checked: { backgroundColor: "#584a32", borderColor: "#584a32" },
  task: { flex: 1, minHeight: 38, justifyContent: "center" },
  taskTitle: { color: "#2e261a", fontSize: 14, fontWeight: "600" },
  taskNote: { color: "#625949", fontSize: 12, marginTop: 3 },
  modal: { backgroundColor: "#f3efe6" },
  details: { flex: 1, paddingHorizontal: 22 },
  back: { alignSelf: "flex-start", paddingVertical: 11 },
  backText: { color: "#5d4a29", fontSize: 13, fontWeight: "700" },
  detailCard: { padding: 18, marginTop: 9, backgroundColor: "#fffdf7", borderRadius: 9 },
  error: { marginTop: 8, fontSize: 12, color: "#ae1c28" },
});
