import { useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Flag, CheckCircle, Clock } from "lucide-react";
import { RenderQualityRating } from "@/types/render-quality";
import { PromptFixGenerator } from "./PromptFixGenerator";
import { CustomerStatusEmail } from "./CustomerStatusEmail";

interface RenderQualityTableProps {
  ratings: RenderQualityRating[];
  onUpdate: () => void;
}

const toolDisplayNames: Record<string, string> = {
  colorpro: "ColorPro",
  designpanelpro: "DesignPanelPro",
  fadewraps: "FadeWraps",
  wbty: "PatternPro",
  approvemode: "ApprovePro",
};

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="text-yellow-500">
      {"★".repeat(rating)}
      {"☆".repeat(5 - rating)}
    </span>
  );
}

export function RenderQualityTable({ ratings, onUpdate }: RenderQualityTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-10"></TableHead>
            <TableHead>Tool</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Issue</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ratings.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No quality ratings found
              </TableCell>
            </TableRow>
          )}
          {ratings.map((rating) => (
            <>
              <TableRow 
                key={rating.id} 
                className="cursor-pointer hover:bg-muted/30"
                onClick={() => toggleExpand(rating.id)}
              >
                <TableCell>
                  {expandedId === rating.id ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {toolDisplayNames[rating.render_type] || rating.render_type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StarRating rating={rating.rating} />
                </TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {rating.is_flagged && (
                    <Flag className="h-3 w-3 text-red-500 inline mr-1" />
                  )}
                  {rating.notes || rating.flag_reason || (
                    <span className="text-muted-foreground">No notes</span>
                  )}
                </TableCell>
                <TableCell>
                  {rating.fix_deployed_at ? (
                    <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Fixed
                    </Badge>
                  ) : rating.is_v2_feature ? (
                    <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30">
                      V2 Feature
                    </Badge>
                  ) : rating.is_flagged ? (
                    <Badge className="bg-red-500/20 text-red-500 border-red-500/30">
                      <Flag className="h-3 w-3 mr-1" />
                      Open
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      <Clock className="h-3 w-3 mr-1" />
                      Pending
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {rating.user_email ? (
                    <span className="text-foreground">{rating.user_email}</span>
                  ) : (
                    <span className="text-muted-foreground">Unknown</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {rating.created_at
                    ? format(new Date(rating.created_at), "MMM d, yyyy")
                    : "-"}
                </TableCell>
              </TableRow>
              {expandedId === rating.id && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-muted/20 p-0">
                    <div className="p-6 space-y-6">
                      {/* Issue Details */}
                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">Issue Details</h4>
                        <div className="bg-background rounded-lg p-4 border border-border">
                          <p className="text-sm text-foreground">
                            <strong>Notes:</strong> {rating.notes || "No notes provided"}
                          </p>
                          {rating.flag_reason && (
                            <p className="text-sm text-foreground mt-2">
                              <strong>Flag Reason:</strong> {rating.flag_reason}
                            </p>
                          )}
                          {rating.gradient_quality_score !== null && (
                            <p className="text-sm text-foreground mt-2">
                              <strong>Gradient Quality Score:</strong> {rating.gradient_quality_score}/5
                            </p>
                          )}
                          {rating.has_hard_line && (
                            <Badge className="mt-2 bg-orange-500/20 text-orange-500 border-orange-500/30">
                              Hard Line Detected
                            </Badge>
                          )}
                          {rating.auto_regenerated && (
                            <Badge className="mt-2 ml-2 bg-purple-500/20 text-purple-500 border-purple-500/30">
                              Auto-Regenerated
                            </Badge>
                          )}
                          {rating.validation_details && (
                            <div className="mt-2">
                              <p className="text-sm text-muted-foreground">
                                <strong>Validation Details:</strong>
                              </p>
                              <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-x-auto">
                                {JSON.stringify(rating.validation_details, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Prompt Fix Generator */}
                      <PromptFixGenerator 
                        rating={rating} 
                        onFixDeployed={onUpdate}
                      />

                      {/* Customer Communication */}
                      <CustomerStatusEmail 
                        rating={rating} 
                        onEmailSent={onUpdate}
                      />

                      {/* Fix Notes */}
                      {rating.fix_notes && (
                        <div className="space-y-2">
                          <h4 className="font-semibold text-foreground">Fix Notes</h4>
                          <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/30">
                            <p className="text-sm text-foreground">{rating.fix_notes}</p>
                            {rating.fix_deployed_at && (
                              <p className="text-xs text-muted-foreground mt-2">
                                Deployed: {format(new Date(rating.fix_deployed_at), "MMM d, yyyy 'at' h:mm a")}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
