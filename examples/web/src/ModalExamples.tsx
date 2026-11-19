import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function ModalExample({ shadow = false }: { shadow?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = shadow ? "Shadow DOM 작업 상세" : "작업 상세";
  return <>
    <button className="modal-launch" onClick={() => dialog.current?.showModal()}>{shadow ? "Shadow DOM 예제" : "모달 예제"}</button>
    <dialog ref={dialog} className="example-dialog" aria-label={title}>
      <h2>{title}</h2>
      <section data-feedback-anchor={shadow ? "shadow-dialog-task" : "dialog-task"}>
        <h3>프로젝트 일정 정리</h3><p>이 영역을 우클릭하면 모달 안에서도 피드백을 남길 수 있어요.</p>
      </section>
      <button onClick={() => dialog.current?.close()}>상세 닫기</button>
    </dialog>
  </>;
}

export function ModalExamples() {
  const host = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => { if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" })); }, []);
  return <div className="modal-examples"><ModalExample /><span ref={host} />{root && createPortal(<>
    <style>{`.modal-launch{font:inherit;font-size:12px;border:1px solid #e3e5e9;border-radius:8px;background:white;padding:10px 14px;color:#727887;cursor:pointer}.example-dialog{font:14px/1.7 sans-serif;color:#30343c;border:1px solid #e3e5e9;border-radius:16px;padding:28px;max-width:420px}.example-dialog::backdrop{background:#20253066}.example-dialog section{background:#f7f8fa;border-radius:10px;padding:20px;margin-bottom:18px}.example-dialog button{cursor:pointer;padding:10px;border:0;border-radius:8px;background:#fff0f1;color:#c82531}`}</style>
    <ModalExample shadow />
  </>, root)}</div>;
}
