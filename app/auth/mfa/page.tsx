import MFAChallenge from "./mfa-challenge";

export default async function MFAChallengeRoute({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = params.next?.startsWith("/app") ? params.next : "/app";
  return <MFAChallenge next={next} />;
}
