"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ImageReplaceGrid } from "../ImageReplaceGrid";
import {
  CategoryPicker,
  AttributeField,
  useRequiredAttributes,
  type CategoryOption,
} from "../../products/new/CategoryAttributeForm";
import { suggestAttributeValue } from "@/import/attribute-mapping";
import { computeSalePrice } from "@/pricing/formula";
import { buildRichContentJson } from "@/ozon/rich-content";
import { PriceCalculatorModal } from "../../products/[offerId]/PriceCalculatorModal";

const MODEL_NAME_ATTRIBUTE_ID = 9048;

interface Variant {
  id: string;
  offerId: string;
  name: string;
  price: string;
  costPrice: string | null;
  weightGrams: number | null;
  unitsInPack: number | null;
  packagingExtraGrams: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  images: unknown;
  originalImages: unknown;
  shopifyMetafields: unknown;
  shopifyVendor: string | null;
  shopifyType: string | null;
  nameRu: string | null;
  descriptionRu: string | null;
  descriptionHtml: string | null;
  status: string;
  excludedFromSubmit: boolean;
  ozonProductId: string | null;
  importTaskId: string | null;
  descriptionCategoryId: number | null;
  typeId: number | null;
  draftAttributes: {
    category: CategoryOption;
    attributes: { id: number; value?: string; dictionaryValueId?: number; displayValue?: string }[];
  } | null;
  modelGroup: { id: string; name: string | null; products: { offerId: string }[] } | null;
}

interface CloneAttribute {
  id: number;
  dictionaryValueId?: number;
  value?: string;
}

interface SearchResult {
  offerId: string;
  name: string;
  shopifyHandle: string | null;
  shopifyVendor: string | null;
  images: unknown;
  originalImages: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

// Bir üründen bir sonrakine/öncekine geçmek için — StagingList'teki aktif filtre/sayfa
// bağlamını (q/vendor/type/status/page) korur ki "sıradaki ürüne geç" listedeki gerçek
// komşu ürüne gitsin, filtreden bağımsız rastgele bir ürüne değil.
interface NavContext {
  q: string;
  vendor: string;
  type: string;
  status: string;
  page: number;
}

function buildHandleHref(targetHandle: string, ctx: NavContext, page: number) {
  const params = new URLSearchParams();
  if (ctx.q) params.set("q", ctx.q);
  if (ctx.vendor) params.set("vendor", ctx.vendor);
  if (ctx.type) params.set("type", ctx.type);
  if (ctx.status) params.set("status", ctx.status);
  if (page > 1) params.set("page", String(page));
  const queryString = params.toString();
  return `/import/${encodeURIComponent(targetHandle)}${queryString ? `?${queryString}` : ""}`;
}

export function HandleEditor({ handle }: { handle: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navContext: NavContext = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      vendor: searchParams.get("vendor") ?? "",
      type: searchParams.get("type") ?? "",
      status: searchParams.get("status") ?? "",
      page: Number(searchParams.get("page")) || 1,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams.toString()],
  );

  const [prevHandle, setPrevHandle] = useState<string | null>(null);
  const [prevPage, setPrevPage] = useState(1);
  const [nextHandle, setNextHandle] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState(1);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const [autoAdvanceProgress, setAutoAdvanceProgress] = useState(0);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAdvanceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Komşu (önceki/sonraki) handle'ları tek bir backend sorgusuyla buluyoruz — böylece bu
  // ürüne hangi bağlamdan gelinirse gelinsin (filtreyle eşleşen bir sayfadan gelinmese
  // bile) doğru sonuç dönüyor.
  useEffect(() => {
    const params = new URLSearchParams();
    if (navContext.q) params.set("q", navContext.q);
    if (navContext.vendor) params.set("vendor", navContext.vendor);
    if (navContext.type) params.set("type", navContext.type);
    if (navContext.status) params.set("status", navContext.status);
    fetch(`/api/import/products/${encodeURIComponent(handle)}/adjacent?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setPrevHandle(data.prevHandle ?? null);
        setPrevPage(data.prevPage ?? 1);
        setNextHandle(data.nextHandle ?? null);
        setNextPage(data.nextPage ?? 1);
      });
  }, [navContext, handle]);

  function goToHandle(targetHandle: string, targetPage: number) {
    router.push(buildHandleHref(targetHandle, navContext, targetPage));
  }

  // Sağ/sol ok tuşlarıyla da gezinme — input/textarea/select içinde yazarken tuşu
  // yakalamıyoruz ki metin düzenlerken imleci hareket ettirmek istediğinizde sayfa değişmesin.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (e.key === "ArrowLeft" && prevHandle) goToHandle(prevHandle, prevPage);
      if (e.key === "ArrowRight" && nextHandle) goToHandle(nextHandle, nextPage);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevHandle, nextHandle, prevPage, nextPage]);

  function cancelAutoAdvance() {
    if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    if (autoAdvanceIntervalRef.current) clearInterval(autoAdvanceIntervalRef.current);
    setAutoAdvancing(false);
    setAutoAdvanceProgress(0);
  }

  function startAutoAdvance() {
    if (!nextHandle) return;
    setAutoAdvancing(true);
    setAutoAdvanceProgress(0);
    const durationMs = 3000;
    const startedAt = Date.now();
    autoAdvanceIntervalRef.current = setInterval(() => {
      setAutoAdvanceProgress(Math.min(100, ((Date.now() - startedAt) / durationMs) * 100));
    }, 50);
    autoAdvanceTimerRef.current = setTimeout(() => {
      if (autoAdvanceIntervalRef.current) clearInterval(autoAdvanceIntervalRef.current);
      goToHandle(nextHandle, nextPage);
    }, durationMs);
  }

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
      if (autoAdvanceIntervalRef.current) clearInterval(autoAdvanceIntervalRef.current);
    };
  }, []);

  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [savingImages, setSavingImages] = useState(false);

  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [richContentJson, setRichContentJson] = useState<string | null>(null);
  const [richContentCopied, setRichContentCopied] = useState(false);

  const [sloganProductName, setSloganProductName] = useState("");
  const [sloganLoading, setSloganLoading] = useState(false);
  const [sloganError, setSloganError] = useState<string | null>(null);
  const [slogan, setSlogan] = useState<{ title: string; slogan1: string; slogan2: string } | null>(null);
  const [copiedSloganField, setCopiedSloganField] = useState<string | null>(null);

  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [cloneAttributes, setCloneAttributes] = useState<CloneAttribute[] | null>(null);
  const [specLoaded, setSpecLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResults, setSubmitResults] = useState<
    { offerId: string; status: "pending" | "imported" | "failed"; ozonProductId?: string | null; error?: string }[] | null
  >(null);
  const [imageSaveError, setImageSaveError] = useState<string | null>(null);
  const [priceCalcOfferId, setPriceCalcOfferId] = useState<string | null>(null);

  // Sunucudan gelen images'i state'e yazarken auto-save efekti bunu "kullanıcı değişikliği"
  // sanıp gereksiz bir PATCH atmasın diye bu bayrağı kullanıyoruz.
  const skipAutoSaveRef = useRef(true);

  // Kategori + attribute seçimleri "Ozon'a Gönder"e basılana kadar sadece bu component'in
  // state'inde duruyordu — kullanıcı yanlışlıkla geri tuşuna basınca ya da sayfa yenilenince
  // tamamı sessizce kayboluyordu. localStorage'a debounce'lu taslak olarak yazıp, sayfa
  // açılışında geri yüklüyoruz; başarılı gönderimde taslağı temizliyoruz.
  const draftKey = `ozon-spec-draft:${handle}`;
  const skipDraftSaveRef = useRef(true);
  const draftRestoredRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}`);
    const data = await res.json();
    const loadedVariants: Variant[] = data.variants ?? [];
    setVariants(loadedVariants);
    skipAutoSaveRef.current = true;
    setImages(asStringArray(loadedVariants?.[0]?.images));
    setSloganProductName((prev) => prev || loadedVariants?.[0]?.name || "");
    return loadedVariants;
  }, [handle]);

  useEffect(() => {
    load();
  }, [load]);

  // Görsel listesindeki HER değişikliği (yükleme, sıralama, kaldırma, kullan/kullanma) DB'ye
  // otomatik kaydeder — Ozon'a göndermeden (o hâlâ "Görselleri Kaydet" butonuyla, kullanıcı
  // kararıyla oluyor). Sayfa yenilenince yükleyip henüz kaydetmediğiniz görsellerin kaybolmaması içindi.
  useEffect(() => {
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/import/products/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, resendToOzon: false }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // Ürün zaten Ozon'a gönderilmişse, daha önce seçilmiş kategori/attribute'ları geri yükle —
  // aksi halde her sayfa açılışında kategori/özellikler sıfırdan seçilmek zorunda kalınıyordu.
  useEffect(() => {
    if (!variants || specLoaded) return;
    const submittedOfferId = variants.find((v) => v.ozonProductId)?.offerId;
    if (!submittedOfferId) return;
    setSpecLoaded(true);
    fetch(`/api/products/${encodeURIComponent(submittedOfferId)}/clone-data`)
      .then((r) => r.json())
      .then((data) => {
        if (data.category) setCategory(data.category);
        if (data.attributes) setCloneAttributes(data.attributes);
      })
      .catch(() => {});
  }, [variants, specLoaded]);

  // "pending" durumda kalmış (daha önce gönderilmiş ama sonucu hiç kontrol edilmemiş)
  // varyantların gerçek Ozon durumunu sayfa açılışında otomatik sorgula.
  useEffect(() => {
    if (!variants) return;
    const pendingWithTask = variants.filter((v) => v.status === "pending" && v.importTaskId);
    for (const v of pendingWithTask) {
      fetch(`/api/products/${encodeURIComponent(v.offerId)}/status`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status !== "pending") {
            setVariants((prev) =>
              prev ? prev.map((p) => (p.offerId === v.offerId ? { ...p, status: data.status } : p)) : prev,
            );
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants?.map((v) => v.offerId).join(",")]);

  const metafields = (variants?.[0]?.shopifyMetafields as Record<string, string> | null) ?? null;
  const vendor = variants?.[0]?.shopifyVendor ?? null;

  const { requiredAttributes, attributesLoading, attributeAnswers, setAttributeAnswers } = useRequiredAttributes(
    category,
    (attr) => {
      // Daha önce Ozon'a gönderilmişse, o zaman seçilmiş gerçek değeri her şeyden önce kullan.
      const cloned = cloneAttributes?.find((a) => a.id === attr.id);
      if (cloned) {
        return {
          dictionaryValueId: cloned.dictionaryValueId,
          value: cloned.value,
          displayValue: cloned.dictionaryValueId ? "(mevcut değer — değiştirmek için yazın)" : undefined,
        };
      }
      const suggested = suggestAttributeValue(attr.name, metafields, vendor);
      return suggested ? { value: suggested, displayValue: suggested } : undefined;
    },
    true,
  );

  // Henüz Ozon'a hiç gönderilmemiş bir handle için, önceki oturumdan kalan taslak
  // kategori/attribute seçimi varsa geri yükle (yukarıdaki clone-data zaten gönderilmiş
  // ürünler için gerçek veriyi çekiyor — bu sadece o durum geçerli değilken çalışır).
  // Öncelik: bu tarayıcıdaki localStorage taslağı > sunucuda (bulk/toplu doldurma ile)
  // kaydedilmiş draftAttributes — ikincisi ekip arkadaşları farklı tarayıcıdan da görsün diye.
  useEffect(() => {
    if (!variants || draftRestoredRef.current) return;
    const alreadySubmitted = variants.some((v) => v.ozonProductId);
    draftRestoredRef.current = true;
    if (alreadySubmitted) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { category?: CategoryOption; attributeAnswers?: Record<number, unknown> };
        if (draft.category) setCategory(draft.category);
        if (draft.attributeAnswers) setAttributeAnswers(draft.attributeAnswers as never);
        return;
      }
      const serverDraft = variants[0]?.draftAttributes;
      if (serverDraft) {
        setCategory(serverDraft.category);
        const answers: Record<number, { value?: string; dictionaryValueId?: number; displayValue?: string }> = {};
        for (const attr of serverDraft.attributes) {
          answers[attr.id] = {
            value: attr.value,
            dictionaryValueId: attr.dictionaryValueId,
            displayValue: attr.displayValue ?? attr.value,
          };
        }
        setAttributeAnswers(answers as never);
      }
    } catch {
      // bozuk/eski taslak — yok say
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  // Kategori/attribute seçimi değiştikçe taslağı localStorage'a debounce'lu yaz — "Ozon'a
  // Gönder"e basmadan önce geri tuşu/yenileme ile seçimlerin sessizce kaybolmasını önler.
  useEffect(() => {
    if (skipDraftSaveRef.current) {
      skipDraftSaveRef.current = false;
      return;
    }
    if (!category && Object.keys(attributeAnswers).length === 0) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ category, attributeAnswers }));
      } catch {
        // localStorage dolu/erişilemez — sessizce vazgeç
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, attributeAnswers]);

  const mandatoryAttributes = requiredAttributes.filter(
    (attr) => attr.is_required && attr.id !== MODEL_NAME_ATTRIBUTE_ID,
  );
  const optionalAttributes = requiredAttributes.filter(
    (attr) => !attr.is_required && attr.id !== MODEL_NAME_ATTRIBUTE_ID,
  );

  const modelGroup = variants?.find((v) => v.modelGroup)?.modelGroup ?? null;

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/import/products/search?q=${encodeURIComponent(query)}&excludeHandle=${encodeURIComponent(handle)}`)
        .then((r) => r.json())
        .then((data) => setSearchResults(data.results ?? []));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, handle]);

  async function saveImages() {
    setSavingImages(true);
    setImageSaveError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json();
      if (data.errors?.length) {
        setImageSaveError(
          data.errors.map((e: { offerId: string; error: string }) => `${e.offerId}: ${e.error}`).join("; "),
        );
      }
      await load();
    } finally {
      setSavingImages(false);
    }
  }

  async function updateVariantField(
    offerId: string,
    field: "weightGrams" | "costPrice" | "unitsInPack" | "name",
    value: string,
  ) {
    const isNumericField = field === "weightGrams" || field === "unitsInPack";
    setVariants((prev) =>
      prev
        ? prev.map((v) => (v.offerId === offerId ? { ...v, [field]: isNumericField ? Number(value) || null : value } : v))
        : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: isNumericField ? Number(value) || 0 : value }),
    });
  }

  // packagingExtraGrams boş bırakılırsa null (varsayılan 10g kullanılır) gönderiliyor — diğer
  // sayısal alanlardan farklı olarak 0'a düşürmüyoruz, 0 ile "varsayılanı kullan" farklı anlamlar.
  async function updateVariantPackagingExtraGrams(offerId: string, value: string) {
    const packagingExtraGrams = value.trim() === "" ? null : Number(value);
    setVariants((prev) =>
      prev ? prev.map((v) => (v.offerId === offerId ? { ...v, packagingExtraGrams } : v)) : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packagingExtraGrams }),
    });
  }

  async function toggleVariantExcluded(offerId: string, excluded: boolean) {
    setVariants((prev) =>
      prev ? prev.map((v) => (v.offerId === offerId ? { ...v, excludedFromSubmit: excluded } : v)) : prev,
    );
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludedFromSubmit: excluded }),
    });
  }

  async function deleteVariant(offerId: string, isSubmitted: boolean) {
    const message = isSubmitted
      ? `${offerId} zaten Ozon'a gönderilmiş — silmek önce Ozon'da arşivleyip sonra kalıcı olarak siler. Emin misiniz?`
      : `${offerId} varyantını kalıcı olarak silmek istediğinize emin misiniz?`;
    if (!confirm(message)) return;
    await fetch(`/api/import/variant/${encodeURIComponent(offerId)}`, { method: "DELETE" });
    setVariants((prev) => (prev ? prev.filter((v) => v.offerId !== offerId) : prev));
  }

  async function applyPriceOverride(offerId: string, costPrice: string, priceUsd: string) {
    await fetch(`/api/products/${encodeURIComponent(offerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costPrice, priceOverride: priceUsd }),
    });
    setPriceCalcOfferId(null);
    await load();
  }

  async function linkModel(targetOfferId: string) {
    await fetch(`/api/import/products/${encodeURIComponent(handle)}/link-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetOfferId }),
    });
    setQuery("");
    setSearchResults([]);
    await load();
  }

  async function translate() {
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/translate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTranslateError(data.error ?? "Çeviri başarısız");
        return false;
      }
      await load();
      return true;
    } finally {
      setTranslating(false);
    }
  }

  async function generateSlogan() {
    setSloganLoading(true);
    setSloganError(null);
    try {
      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/slogan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: sloganProductName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSloganError(data.error ?? "Slogan oluşturulamadı");
        return;
      }
      setSlogan(data);
    } finally {
      setSloganLoading(false);
    }
  }

  async function copySloganField(field: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedSloganField(field);
    setTimeout(() => setCopiedSloganField((current) => (current === field ? null : current)), 1500);
  }

  async function unlinkModel() {
    await fetch(`/api/import/products/${encodeURIComponent(handle)}/link-model`, { method: "DELETE" });
    await load();
  }

  function pollSubmittedVariant(offerId: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/products/${encodeURIComponent(offerId)}/status`);
      const data = await res.json();
      if (data.status !== "pending") {
        clearInterval(interval);
        setSubmitResults((prev) => {
          if (!prev) return prev;
          const next = prev.map((r) =>
            r.offerId === offerId
              ? { ...r, status: data.status, ozonProductId: data.ozonProductId, error: data.error }
              : r,
          );
          // Gerçek sonuç (Ozon moderasyonu/oluşturma) belli olduğunda — "pending" kalan
          // yok ve en az biri başarıyla oluştuysa — otomatik geçişi ancak o zaman başlat.
          // Önceden /submit isteği döner dönmez başlatılıyordu, bu da henüz gerçek
          // sonuç belli olmadan sıradaki ürüne geçilmiş gibi hissettiriyordu.
          const allResolved = next.every((r) => r.status !== "pending");
          if (allResolved && next.some((r) => r.status === "imported")) {
            startAutoAdvance();
          }
          return next;
        });
        load();
      }
    }, 3000);
  }

  async function submit() {
    if (!category) return;
    setSubmitting(true);
    setSubmitResults(null);
    try {
      // Rusça çeviri unutulmuş olabiliyor — göndermeden önce sessizce (uyarı vermeden)
      // otomatik çeviriyoruz, aksi halde Ozon Latin harfli ismi "critical" hata olarak
      // reddediyor. "Çevriliyor..." durumu translate() zaten gösteriyor.
      if (variants?.some((v) => !v.nameRu)) {
        const translated = await translate();
        if (!translated) return;
      }

      const res = await fetch(`/api/import/products/${encodeURIComponent(handle)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descriptionCategoryId: category.descriptionCategoryId,
          typeId: category.typeId,
          // Sadece zorunlu değil, kullanıcının doldurduğu opsiyonel (içerik puanını artıran)
          // attribute'lar da gönderilir — cevaplanmamış opsiyonel alanlar atlanır.
          attributes: [...mandatoryAttributes, ...optionalAttributes]
            .filter((attr) => attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId)
            .map((attr) => ({
              id: attr.id,
              value: attributeAnswers[attr.id]?.value,
              dictionaryValueId: attributeAnswers[attr.id]?.dictionaryValueId,
            })),
        }),
      });
      const data = await res.json();
      const results = (data.results ?? []) as { offerId: string; taskId?: string; error?: string }[];
      setSubmitResults(
        results.map((r) => ({
          offerId: r.offerId,
          status: r.error ? ("failed" as const) : ("pending" as const),
          error: r.error,
        })),
      );
      for (const r of results) {
        if (!r.error) pollSubmittedVariant(r.offerId);
      }
      if (results.some((r) => !r.error)) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // önemli değil, taslak bir sonraki gönderimde zaten üzerine yazılır
        }
        // Otomatik geçiş burada DEĞİL, pollSubmittedVariant içinde gerçek sonuç (Ozon
        // moderasyonu tamamlanınca) belli olduğunda başlatılıyor.
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = useMemo(() => {
    if (!category) return false;
    return mandatoryAttributes.every(
      (attr) => Boolean(attributeAnswers[attr.id]?.value || attributeAnswers[attr.id]?.dictionaryValueId),
    );
  }, [category, mandatoryAttributes, attributeAnswers]);

  if (!variants) {
    return (
      <div className="page-wide">
        <div className="card">Yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className="page-wide">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={!prevHandle}
            onClick={() => prevHandle && goToHandle(prevHandle, prevPage)}
            title="Önceki ürün"
          >
            ←
          </button>
          <h1 style={{ margin: 0 }}>{variants[0]?.name ?? handle}</h1>
          <button
            type="button"
            className="btn-secondary"
            disabled={!nextHandle}
            onClick={() => nextHandle && goToHandle(nextHandle, nextPage)}
            title="Sonraki ürün"
          >
            →
          </button>
        </div>
        <Link href={`/import?${searchParams.toString()}`}>
          <button className="btn-secondary">← Listeye dön</button>
        </Link>
      </div>

      {autoAdvancing && (
        <div className="card" style={{ marginBottom: 16, background: "var(--accent-bg, #16321f)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span>✓ Başarıyla gönderildi — sonraki ürüne geçiliyor…</span>
            <button type="button" className="btn-secondary" onClick={cancelAutoAdvance}>
              Durdur
            </button>
          </div>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${autoAdvanceProgress}%`,
                background: "var(--accent)",
                transition: "width 50ms linear",
              }}
            />
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Görseller</label>
        <ImageReplaceGrid
          originalImages={asStringArray(variants[0]?.originalImages)}
          images={images}
          onChange={setImages}
        />
        <button className="btn-primary" style={{ marginTop: 12 }} disabled={savingImages} onClick={saveImages}>
          {savingImages ? "Kaydediliyor..." : "Görselleri Kaydet"}
        </button>
        {variants.some((v) => v.ozonProductId) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Bu ürün zaten Ozon'a gönderilmiş — kaydedince görseller Ozon'a da yeniden gönderilir.
          </div>
        )}
        {imageSaveError && <div className="hint" style={{ color: "var(--danger)", marginTop: 8 }}>{imageSaveError}</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Canva Slogan Oluştur</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          İnfografik görsel için Rusça ana başlık + 2 kısa slogan üretir (Canva'da kullanmak üzere kopyalayın).
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={sloganProductName}
            onChange={(e) => setSloganProductName(e.target.value)}
            placeholder="Ürün adı"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-primary" disabled={sloganLoading || !sloganProductName.trim()} onClick={generateSlogan}>
            {sloganLoading ? "Oluşturuluyor..." : "Slogan Oluştur"}
          </button>
        </div>
        {sloganError && <div className="hint" style={{ color: "var(--danger)" }}>{sloganError}</div>}
        {slogan && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {(
              [
                ["title", "Başlık", slogan.title],
                ["slogan1", "Slogan 1", slogan.slogan1],
                ["slogan2", "Slogan 2", slogan.slogan2],
              ] as const
            ).map(([field, label, value]) => (
              <div
                key={field}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#0f1216",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <div className="hint" style={{ margin: 0 }}>{label}</div>
                  <strong>{value}</strong>
                </div>
                <button type="button" className="btn-secondary" onClick={() => copySloganField(field, value)}>
                  {copiedSloganField === field ? "Kopyalandı ✓" : "Kopyala"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {variants[0]?.descriptionHtml && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label>Orijinal Shopify Açıklaması</label>
          <div
            className="hint"
            style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}
            dangerouslySetInnerHTML={{ __html: variants[0].descriptionHtml }}
          />
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ margin: 0 }}>Rusça Çeviri</label>
          <button type="button" className="btn-secondary" disabled={translating} onClick={translate}>
            {translating ? "Çevriliyor..." : "Rusça'ya Çevir"}
          </button>
        </div>
        {translateError && <div className="hint" style={{ color: "var(--danger)" }}>{translateError}</div>}
        {variants[0]?.nameRu && (
          <>
            <div className="field">
              <label>Başlık (RU)</label>
              <input type="text" defaultValue={variants[0].nameRu} />
            </div>
            <div className="field">
              <label>Açıklama (RU)</label>
              <textarea rows={6} defaultValue={variants[0].descriptionRu ?? ""} />
            </div>
            <div className="hint">
              Ozon'un ürün açıklaması genellikle kategoriye özel bir attribute (örn. "Аннотация") üzerinden gönderiliyor
              — aşağıdaki attribute formunda o alana bu metni yapıştırabilirsiniz.
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ margin: 0 }}>Rich Content JSON</label>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const v = variants[0];
                  setRichContentJson(buildRichContentJson(v.descriptionRu ?? "", v.nameRu ?? v.name));
                  setRichContentCopied(false);
                }}
              >
                Oluştur
              </button>
            </div>
            {richContentJson && (
              <>
                <textarea readOnly rows={6} value={richContentJson} style={{ fontFamily: "monospace", fontSize: 12 }} />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: 6 }}
                  onClick={async () => {
                    await navigator.clipboard.writeText(richContentJson);
                    setRichContentCopied(true);
                  }}
                >
                  {richContentCopied ? "Kopyalandı ✓" : "Kopyala"}
                </button>
                <div className="hint" style={{ marginTop: 6 }}>
                  Ozon'da ürünü açtıktan sonra "Rich content design tool" → sağ üstteki kod/JSON düzenleme
                  seçeneğine bu metni yapıştırın.
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Varyantlar ({variants.length})</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          "Pasifleştir" bir varyantı silmeden Ozon'a göndermeyi atlar (geri aktifleştirilebilir). "Sil" kalıcıdır.
          Ürün zaten gönderilmişse, ağırlık/alış fiyatı değiştirince yeni satış fiyatı otomatik Ozon'a gider —
          ağırlığın kendisi Ozon'da değişmez, o "Görselleri Kaydet" gibi tam bir yeniden gönderim gerektirir.
        </div>
        <table style={{ tableLayout: "fixed", wordBreak: "break-word" }}>
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Ad</th>
              <th>Ağırlık (g)</th>
              <th title="Standart 10g paketleme payını override eder — metal kutu/ağır ambalaj gibi standart dışı ürünlerde kullanılır, boş = varsayılan 10g">
                Paket Payı (g)
              </th>
              <th title="Kutu/paket içindeki adet — Ozon'un varyant birleştirme kuralı için farklı varyantlarda gerçekten farklı olmalı">
                Adet
              </th>
              <th>Alış Fiyatı (USD)</th>
              <th>Satış Fiyatı</th>
              <th>Durum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} style={v.excludedFromSubmit ? { opacity: 0.5 } : undefined}>
                <td>{v.offerId}</td>
                <td>
                  <input
                    type="text"
                    style={{ width: "100%" }}
                    defaultValue={v.name}
                    onBlur={(e) => updateVariantField(v.offerId, "name", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 90 }}
                    defaultValue={v.weightGrams ?? ""}
                    onBlur={(e) => updateVariantField(v.offerId, "weightGrams", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 70 }}
                    defaultValue={v.packagingExtraGrams ?? ""}
                    placeholder="10"
                    onBlur={(e) => updateVariantPackagingExtraGrams(v.offerId, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 60 }}
                    defaultValue={v.unitsInPack ?? ""}
                    placeholder="1"
                    onBlur={(e) => updateVariantField(v.offerId, "unitsInPack", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: 90 }}
                    defaultValue={v.costPrice ?? ""}
                    onBlur={(e) => updateVariantField(v.offerId, "costPrice", e.target.value)}
                  />
                </td>
                <td>
                  {computeSalePrice(v.costPrice ?? "0", v.weightGrams, undefined, v.packagingExtraGrams) || v.price}
                  {v.ozonProductId && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginLeft: 6, fontSize: 11, padding: "2px 6px" }}
                      onClick={() => setPriceCalcOfferId(v.offerId)}
                    >
                      Düzenle
                    </button>
                  )}
                </td>
                <td>
                  {v.excludedFromSubmit ? (
                    <span className="badge failed">pasif</span>
                  ) : (
                    <span className={`badge ${v.status}`}>{v.status}</span>
                  )}
                </td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => toggleVariantExcluded(v.offerId, !v.excludedFromSubmit)}
                  >
                    {v.excludedFromSubmit ? "Aktifleştir" : "Pasifleştir"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => deleteVariant(v.offerId, Boolean(v.ozonProductId))}
                  >
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {priceCalcOfferId &&
        (() => {
          const v = variants.find((variant) => variant.offerId === priceCalcOfferId);
          if (!v) return null;
          return (
            <PriceCalculatorModal
              costPrice={v.costPrice ?? ""}
              weightGrams={v.weightGrams}
              widthCm={v.widthCm}
              heightCm={v.heightCm}
              depthCm={v.depthCm}
              packagingExtraGrams={v.packagingExtraGrams}
              currentPrice={computeSalePrice(v.costPrice ?? "0", v.weightGrams, undefined, v.packagingExtraGrams) || v.price}
              onClose={() => setPriceCalcOfferId(null)}
              onApply={(priceUsd) => applyPriceOverride(v.offerId, v.costPrice ?? "0", priceUsd)}
            />
          );
        })()}

      <div className="card" style={{ marginBottom: 16 }}>
        <label>Modele Bağla</label>
        <div className="hint">
          Farklı bir Shopify ürününü (örn. aynı ürünün farklı bir aroması) burada arayıp seçerseniz, ikisi Ozon'da tek
          kartta (aynı model) gösterilir.
        </div>
        {modelGroup ? (
          <div className="selected-pill" style={{ marginTop: 8 }}>
            <strong>Grup: {modelGroup.name}</strong> ({modelGroup.products.length} üye)
            <button className="btn-secondary" onClick={unlinkModel} type="button">
              Gruptan Çıkar
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder="Ürün adı veya SKU ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginTop: 8 }}
            />
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r) => {
                  const thumb = asStringArray(r.images)[0] ?? asStringArray(r.originalImages)[0] ?? null;
                  return (
                    <div
                      key={r.offerId}
                      className="search-result-item"
                      style={{ display: "flex", gap: 10, alignItems: "center" }}
                      onClick={() => linkModel(r.offerId)}
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="zoom-thumb"
                          style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: "#1a1e24", flexShrink: 0 }} />
                      )}
                      <div>
                        <strong>{r.name}</strong>
                        <div className="hint" style={{ margin: 0 }}>
                          {r.offerId} · {r.shopifyHandle}
                          {r.shopifyVendor ? ` · ${r.shopifyVendor}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <label>Ozon'a Gönder</label>
        <div className="row" style={{ marginBottom: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Vendor (Shopify)</label>
            {variants[0]?.shopifyVendor ?? <span className="hint">—</span>}
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Type (Shopify)</label>
            {variants[0]?.shopifyType ?? <span className="hint">—</span>}
          </div>
        </div>
        <div className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
          Kategori seçerken Type'ı, Marka (Brand) attribute'unu doldururken Vendor'ı referans alabilirsiniz.
        </div>
        <CategoryPicker selected={category} onSelect={setCategory} />
        {attributesLoading && <div className="hint">Kategori özellikleri yükleniyor...</div>}
        {category && mandatoryAttributes.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 8 }}>Zorunlu özellikler</div>
            {mandatoryAttributes.map((attr) => (
              <AttributeField
                key={attr.id}
                attr={attr}
                category={category}
                answer={attributeAnswers[attr.id]}
                onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
              />
            ))}
          </>
        )}
        {category && optionalAttributes.length > 0 && (
          <>
            <div className="hint" style={{ marginTop: 20 }}>
              Opsiyonel özellikler — doldurmak zorunlu değil, ama Ozon'un içerik puanını/görünürlüğü artırır (ör.
              Annotation, Composition, PDF, JSON rich content).
            </div>
            {optionalAttributes.map((attr) => (
              <AttributeField
                key={attr.id}
                attr={attr}
                category={category}
                answer={attributeAnswers[attr.id]}
                onChange={(answer) => setAttributeAnswers((prev) => ({ ...prev, [attr.id]: answer }))}
              />
            ))}
          </>
        )}

        <button className="btn-primary" disabled={!canSubmit || submitting} onClick={submit} style={{ marginTop: 12 }}>
          {submitting && translating ? "Rusça'ya çevriliyor..." : submitting ? "Gönderiliyor..." : "Ozon'a Gönder"}
        </button>

        {submitResults && (
          <div style={{ marginTop: 16 }}>
            {submitResults.map((r) => (
              <div key={r.offerId} className={`status-banner ${r.status}`}>
                <strong>{r.offerId}</strong> —{" "}
                {r.status === "pending" && "Gönderildi, Ozon işliyor... (birkaç dakika sürebilir)"}
                {r.status === "imported" && `Başarıyla oluşturuldu! product_id: ${r.ozonProductId}`}
                {r.status === "failed" && `Hata: ${r.error ?? "Bilinmeyen hata"}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
