import {
  Card,
  Page,
  Layout,
  TextContainer,
  Image,
  Stack,
  Link,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useTranslation, Trans } from "react-i18next";

import { trophyImage } from "../assets";
import { useEffect } from "react";
import { ProductsCard } from "../components";

export default function HomePage() {
  useEffect(() => {
    let a = fetch("/api/register-webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log(a);
  }, []);
  const { t } = useTranslation();
  return (
    <Page narrowWidth>

    </Page>
  );
}
