import { ozonPost } from "./client";

export interface OzonCategoryTreeNode {
  description_category_id: number;
  category_name: string;
  type_id?: number;
  type_name?: string;
  disabled: boolean;
  children?: OzonCategoryTreeNode[];
}

export interface OzonCategoryTreeResponse {
  result: OzonCategoryTreeNode[];
}

export function getCategoryTree(languageCode = "RU") {
  return ozonPost<OzonCategoryTreeResponse>("/v1/description-category/tree", {
    language: languageCode,
  });
}

export interface OzonCategoryAttribute {
  id: number;
  name: string;
  description: string;
  type: string;
  is_collection: boolean;
  is_required: boolean;
  is_aspect: boolean;
  category_dependent: boolean;
  dictionary_id: number;
}

export interface OzonCategoryAttributesResponse {
  result: OzonCategoryAttribute[];
}

export function getCategoryAttributes(params: {
  descriptionCategoryId: number;
  typeId: number;
  languageCode?: string;
}) {
  return ozonPost<OzonCategoryAttributesResponse>("/v1/description-category/attribute", {
    description_category_id: params.descriptionCategoryId,
    type_id: params.typeId,
    language: params.languageCode ?? "RU",
  });
}

export interface OzonAttributeValuesResponse {
  result: Array<{ id: number; value: string; info?: string }>;
  has_next: boolean;
}

export interface OzonAttributeValueSearchResponse {
  result: Array<{ id: number; value: string; info?: string; picture?: string }>;
}

export function searchAttributeValues(params: {
  attributeId: number;
  descriptionCategoryId: number;
  typeId: number;
  value: string;
  limit?: number;
}) {
  return ozonPost<OzonAttributeValueSearchResponse>("/v1/description-category/attribute/values/search", {
    attribute_id: params.attributeId,
    description_category_id: params.descriptionCategoryId,
    type_id: params.typeId,
    value: params.value,
    limit: params.limit ?? 20,
  });
}

export function getAttributeValues(params: {
  attributeId: number;
  descriptionCategoryId: number;
  typeId: number;
  lastValueId?: number;
  limit?: number;
  languageCode?: string;
}) {
  return ozonPost<OzonAttributeValuesResponse>("/v1/description-category/attribute/values", {
    attribute_id: params.attributeId,
    description_category_id: params.descriptionCategoryId,
    type_id: params.typeId,
    last_value_id: params.lastValueId ?? 0,
    limit: params.limit ?? 100,
    language: params.languageCode ?? "RU",
  });
}
