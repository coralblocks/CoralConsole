import ActorDetail from "./actor-detail";

export default async function ActorDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ActorDetail actorId={id} />;
}
