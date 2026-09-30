"use client";
import { useParams } from 'next/navigation';
import { FacebookCampaignEditor } from '@/components/facebook-campaign';

export default function EditFacebookCampaign() {
  const { id } = useParams<{ id: string }>();
  return <FacebookCampaignEditor campaignId={id} />;
}
