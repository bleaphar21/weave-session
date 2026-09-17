import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/data";

export const revalidate = 3600;

export default async function Home() {
  const data = await getDashboardData();
  return <Dashboard data={data} />;
}
