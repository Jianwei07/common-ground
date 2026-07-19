import { WorkspaceApp } from "../../../components/workspace-app";

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <WorkspaceApp roomId={roomId} />;
}
