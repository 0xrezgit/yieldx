import ScenarioDetail from './ScenarioDetail';

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScenarioDetail id={decodeURIComponent(id)} />;
}
