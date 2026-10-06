
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "key": string,"value": string
                  }
                  Insert: {
                    "key": string,"value": string
                  }
                  Update: {
                    "key"?: string,"value"?: string
                  }
                  Relationships: [
                    
                  ]
                },"app_users": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string,"id": string,"role"?: Database["public"]['Enums']["app_role"]
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"role"?: Database["public"]['Enums']["app_role"]
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"at": string,"entity": string,"entity_id": string | null,"id": number
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    
                  ]
                },"checker_reviews": {
                  Row: {
                    "checker_id": string,"comment": string,"created_at": string,"id": string,"status": Database["public"]['Enums']["review_status"],"version_id": string
                  }
                  Insert: {
                    "checker_id": string,"comment"?: string,"created_at"?: string,"id"?: string,"status"?: Database["public"]['Enums']["review_status"],"version_id": string
                  }
                  Update: {
                    "checker_id"?: string,"comment"?: string,"created_at"?: string,"id"?: string,"status"?: Database["public"]['Enums']["review_status"],"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checker_reviews_checker_id_fkey"
      columns: ["checker_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checker_reviews_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"experience_highlights": {
                  Row: {
                    "experience_id": string,"position": number,"text": string
                  }
                  Insert: {
                    "experience_id": string,"position": number,"text"?: string
                  }
                  Update: {
                    "experience_id"?: string,"position"?: number,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "experience_highlights_experience_id_fkey"
      columns: ["experience_id"]
isOneToOne: false
      referencedRelation: "version_experience"
      referencedColumns: ["id"]
    }
                  ]
                },"profile_versions": {
                  Row: {
                    "analysis": Json | null,"created_at": string,"created_by": string,"experience_summary": string,"id": string,"job_title": string,"kind": Database["public"]['Enums']["version_kind"],"label": string,"name": string,"overview": string,"parent_version_id": string | null,"profile_id": string,"prompt_plan": (string)[] | null,"search": unknown,"source": string,"specialization": string,"version_no": number
                  }
                  Insert: {
                    "analysis"?: Json | null,"created_at"?: string,"created_by": string,"experience_summary"?: string,"id"?: string,"job_title"?: string,"kind": Database["public"]['Enums']["version_kind"],"label"?: string,"name"?: string,"overview"?: string,"parent_version_id"?: string | null,"profile_id": string,"prompt_plan"?: (string)[] | null,"search"?: unknown,"source": string,"specialization"?: string,"version_no": number
                  }
                  Update: {
                    "analysis"?: Json | null,"created_at"?: string,"created_by"?: string,"experience_summary"?: string,"id"?: string,"job_title"?: string,"kind"?: Database["public"]['Enums']["version_kind"],"label"?: string,"name"?: string,"overview"?: string,"parent_version_id"?: string | null,"profile_id"?: string,"prompt_plan"?: (string)[] | null,"search"?: unknown,"source"?: string,"specialization"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_versions_parent_version_id_fkey"
      columns: ["parent_version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_versions_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "archived": boolean,"candidate_name": string,"created_at": string,"current_version_id": string | null,"id": string,"owner_id": string,"template": Database["public"]['Enums']["template_kind"],"updated_at": string
                  }
                  Insert: {
                    "archived"?: boolean,"candidate_name"?: string,"created_at"?: string,"current_version_id"?: string | null,"id"?: string,"owner_id": string,"template": Database["public"]['Enums']["template_kind"],"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"candidate_name"?: string,"created_at"?: string,"current_version_id"?: string | null,"id"?: string,"owner_id"?: string,"template"?: Database["public"]['Enums']["template_kind"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"project_responsibilities": {
                  Row: {
                    "position": number,"project_id": string,"text": string
                  }
                  Insert: {
                    "position": number,"project_id": string,"text"?: string
                  }
                  Update: {
                    "position"?: number,"project_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_responsibilities_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "version_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_technologies": {
                  Row: {
                    "name": string,"position": number,"project_id": string
                  }
                  Insert: {
                    "name"?: string,"position": number,"project_id": string
                  }
                  Update: {
                    "name"?: string,"position"?: number,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_technologies_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "version_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"review_items": {
                  Row: {
                    "id": string,"path": string,"reason": string,"resolved": boolean,"review_id": string
                  }
                  Insert: {
                    "id"?: string,"path"?: string,"reason"?: string,"resolved"?: boolean,"review_id": string
                  }
                  Update: {
                    "id"?: string,"path"?: string,"reason"?: string,"resolved"?: boolean,"review_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_items_review_id_fkey"
      columns: ["review_id"]
isOneToOne: false
      referencedRelation: "checker_reviews"
      referencedColumns: ["id"]
    }
                  ]
                },"version_education": {
                  Row: {
                    "qualification": string,"version_id": string,"year": string
                  }
                  Insert: {
                    "qualification"?: string,"version_id": string,"year"?: string
                  }
                  Update: {
                    "qualification"?: string,"version_id"?: string,"year"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_education_version_id_fkey"
      columns: ["version_id"]
isOneToOne: true
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"version_experience": {
                  Row: {
                    "company": string,"duration": string,"id": string,"position": number,"position_title": string,"version_id": string
                  }
                  Insert: {
                    "company"?: string,"duration"?: string,"id"?: string,"position": number,"position_title"?: string,"version_id": string
                  }
                  Update: {
                    "company"?: string,"duration"?: string,"id"?: string,"position"?: number,"position_title"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_experience_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"version_list_items": {
                  Row: {
                    "kind": Database["public"]['Enums']["list_kind"],"position": number,"value": string,"version_id": string
                  }
                  Insert: {
                    "kind": Database["public"]['Enums']["list_kind"],"position": number,"value"?: string,"version_id": string
                  }
                  Update: {
                    "kind"?: Database["public"]['Enums']["list_kind"],"position"?: number,"value"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_list_items_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"version_projects": {
                  Row: {
                    "description": string,"duration": string,"id": string,"position": number,"project_link": string,"project_name": string,"role": string,"team_size": string,"version_id": string
                  }
                  Insert: {
                    "description"?: string,"duration"?: string,"id"?: string,"position": number,"project_link"?: string,"project_name"?: string,"role"?: string,"team_size"?: string,"version_id": string
                  }
                  Update: {
                    "description"?: string,"duration"?: string,"id"?: string,"position"?: number,"project_link"?: string,"project_name"?: string,"role"?: string,"team_size"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_projects_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"version_review_flags": {
                  Row: {
                    "path": string,"position": number,"reason": string,"version_id": string
                  }
                  Insert: {
                    "path"?: string,"position": number,"reason"?: string,"version_id": string
                  }
                  Update: {
                    "path"?: string,"position"?: number,"reason"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_review_flags_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"version_skills": {
                  Row: {
                    "name": string,"position": number,"rating": string | null,"version_id": string
                  }
                  Insert: {
                    "name"?: string,"position": number,"rating"?: string | null,"version_id": string
                  }
                  Update: {
                    "name"?: string,"position"?: number,"rating"?: string | null,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_skills_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "profile_versions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_jarr":
{ Args: { "j": Json }; Returns: Json
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"get_profile_version":
{ Args: { "p_version_id": string }; Returns: Json
                           },
"save_profile_version":
{ Args: { "p_analysis": Json,"p_flags": Json,"p_kind": Database["public"]['Enums']["version_kind"],"p_label": string,"p_parent": string,"p_profile": Json,"p_profile_id": string,"p_prompt_plan": (string)[],"p_source": string,"p_template": Database["public"]['Enums']["template_kind"] }; Returns: {
              "new_version_id": string,"new_version_no": number
            }[]
                           }
          }
          Enums: {
            "app_role": "team_member"|"checker"|"manager"|"admin","list_kind": "certification"|"tool"|"domain"|"language"|"managerial"|"skill_plain","review_status": "pending"|"approved"|"changes_requested","template_kind": "internal"|"external","version_kind": "base"|"role_specific"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["team_member", "checker", "manager", "admin"],"list_kind": ["certification", "tool", "domain", "language", "managerial", "skill_plain"],"review_status": ["pending", "approved", "changes_requested"],"template_kind": ["internal", "external"],"version_kind": ["base", "role_specific"]
          }
        }
} as const
