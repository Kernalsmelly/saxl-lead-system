export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      follow_ups: {
        Row: {
          created_at: string
          due_at: string
          id: string
          lead_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["follow_up_status"]
          type: Database["public"]["Enums"]["follow_up_type"]
        }
        Insert: {
          created_at?: string
          due_at: string
          id?: string
          lead_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          type: Database["public"]["Enums"]["follow_up_type"]
        }
        Update: {
          created_at?: string
          due_at?: string
          id?: string
          lead_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          type?: Database["public"]["Enums"]["follow_up_type"]
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          completed_date: string | null
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          revenue: number | null
          scheduled_date: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          revenue?: number | null
          scheduled_date?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          revenue?: number | null
          scheduled_date?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["lead_event_type"]
          id: string
          lead_id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["lead_event_type"]
          id?: string
          lead_id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["lead_event_type"]
          id?: string
          lead_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          assigned_to: string | null
          city: string | null
          email: string | null
          id: string
          instagram_handle: string | null
          job_date: string | null
          last_updated_at: string
          name: string | null
          notes: string | null
          parsed_confidence: number | null
          phone: string | null
          preferred_date: string | null
          quote_amount: number | null
          raw_payload: Json
          received_at: string
          revenue: number | null
          service_type: string | null
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          assigned_to?: string | null
          city?: string | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          job_date?: string | null
          last_updated_at?: string
          name?: string | null
          notes?: string | null
          parsed_confidence?: number | null
          phone?: string | null
          preferred_date?: string | null
          quote_amount?: number | null
          raw_payload?: Json
          received_at?: string
          revenue?: number | null
          service_type?: string | null
          source: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          assigned_to?: string | null
          city?: string | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          job_date?: string | null
          last_updated_at?: string
          name?: string | null
          notes?: string | null
          parsed_confidence?: number | null
          phone?: string | null
          preferred_date?: string | null
          quote_amount?: number | null
          raw_payload?: Json
          received_at?: string
          revenue?: number | null
          service_type?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_channels: {
        Row: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          config: Json
          created_at: string
          enabled: boolean
          id: string
          tenant_id: string
        }
        Insert: {
          channel_type: Database["public"]["Enums"]["channel_type"]
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          tenant_id: string
        }
        Update: {
          channel_type?: Database["public"]["Enums"]["channel_type"]
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_email: string
          owner_phone: string | null
          owner_user_id: string
          timezone: string
          website: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_email: string
          owner_phone?: string | null
          owner_user_id: string
          timezone?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_email?: string
          owner_phone?: string | null
          owner_user_id?: string
          timezone?: string
          website?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      channel_type: "website_form" | "sms" | "voice" | "meta_dm"
      follow_up_status: "pending" | "sent" | "cancelled" | "completed"
      follow_up_type:
        | "48h_response"
        | "7d_quote_followup"
        | "14d_cold_check"
        | "custom"
      job_status:
        | "scheduled"
        | "in_progress"
        | "completed"
        | "rescheduled"
        | "cancelled"
      lead_event_type:
        | "captured"
        | "owner_notified"
        | "auto_reply_sent"
        | "status_changed"
        | "follow_up_sent"
        | "note_added"
      lead_source:
        | "website_form"
        | "phone_call"
        | "sms"
        | "instagram_dm"
        | "facebook_dm"
        | "other"
      lead_status:
        | "new"
        | "contacted"
        | "quoted"
        | "booked"
        | "won"
        | "lost"
        | "cold"
        | "unparsed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      channel_type: ["website_form", "sms", "voice", "meta_dm"],
      follow_up_status: ["pending", "sent", "cancelled", "completed"],
      follow_up_type: [
        "48h_response",
        "7d_quote_followup",
        "14d_cold_check",
        "custom",
      ],
      job_status: [
        "scheduled",
        "in_progress",
        "completed",
        "rescheduled",
        "cancelled",
      ],
      lead_event_type: [
        "captured",
        "owner_notified",
        "auto_reply_sent",
        "status_changed",
        "follow_up_sent",
        "note_added",
      ],
      lead_source: [
        "website_form",
        "phone_call",
        "sms",
        "instagram_dm",
        "facebook_dm",
        "other",
      ],
      lead_status: [
        "new",
        "contacted",
        "quoted",
        "booked",
        "won",
        "lost",
        "cold",
        "unparsed",
      ],
    },
  },
} as const
