import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { downloadInkFusionSampleChart } from '@/lib/inkfusion-sample-chart-generator';
import { downloadInkFusionPoster } from '@/lib/inkfusion-poster-generator';
import { Download, FileText, Loader2, Printer, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { inkFusionColors } from '@/lib/restyleproai-colors';

type ChartFormat = 'standard' | 'poster';

const AdminInkFusionSampleChart = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [chartFormat, setChartFormat] = useState<ChartFormat>('poster');
  const [includeGloss, setIncludeGloss] = useState(true);
  const [includeSatin, setIncludeSatin] = useState(true);
  const [includeMatte, setIncludeMatte] = useState(true);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      if (chartFormat === 'poster') {
        await downloadInkFusionPoster('InkFusion-50-Color-Poster-48x36.pdf');
        toast.success('48" × 36" poster PDF downloaded!');
      } else {
        const finishes: ('Gloss' | 'Satin' | 'Matte')[] = [];
        if (includeGloss) finishes.push('Gloss');
        if (includeSatin) finishes.push('Satin');
        if (includeMatte) finishes.push('Matte');

        if (finishes.length === 0) {
          toast.error('Select at least one finish type');
          return;
        }

        await downloadInkFusionSampleChart('InkFusion-Color-Sample-Chart.pdf', {
          includeFinishes: finishes,
        });
        toast.success('Sample chart PDF downloaded!');
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  // Count unique colors
  const glossColors = inkFusionColors.filter((c) => c.finish === 'Gloss');
  const uniqueGloss = [...new Set(glossColors.map((c) => c.name))].length;
  const satinColors = inkFusionColors.filter((c) => c.finish === 'Satin');
  const uniqueSatin = [...new Set(satinColors.map((c) => c.name))].length;
  const matteColors = inkFusionColors.filter((c) => c.finish === 'Matte');
  const uniqueMatte = [...new Set(matteColors.map((c) => c.name))].length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">InkFusion™ Color Chart Generator</h1>
          <p className="text-muted-foreground">
            Generate professional PDF color charts for print or digital distribution.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Chart Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Format Selection */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Chart Format</Label>
                <RadioGroup
                  value={chartFormat}
                  onValueChange={(value) => setChartFormat(value as ChartFormat)}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-3 p-4 rounded-lg border border-primary bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors">
                    <RadioGroupItem value="poster" id="poster" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="poster" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                        <Printer className="h-4 w-4 text-primary" />
                        Professional Poster (48" × 36")
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Large format poster with all 50 colors in a 10×5 grid. Includes hex codes and CMYK values.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value="standard" id="standard" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="standard" className="text-base font-semibold cursor-pointer flex items-center gap-2">
                        <LayoutGrid className="h-4 w-4" />
                        Standard Chart (A4)
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Multi-page A4 document organized by color family. Select finish types to include.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {/* Finish Selection (only for standard format) */}
              {chartFormat === 'standard' && (
                <div className="pt-4 border-t">
                  <Label className="text-sm font-medium mb-3 block">Include Finishes</Label>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="gloss"
                        checked={includeGloss}
                        onCheckedChange={(checked) => setIncludeGloss(checked as boolean)}
                      />
                      <Label htmlFor="gloss" className="text-sm cursor-pointer">
                        Gloss ({uniqueGloss} colors)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="satin"
                        checked={includeSatin}
                        onCheckedChange={(checked) => setIncludeSatin(checked as boolean)}
                      />
                      <Label htmlFor="satin" className="text-sm cursor-pointer">
                        Satin ({uniqueSatin} colors)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="matte"
                        checked={includeMatte}
                        onCheckedChange={(checked) => setIncludeMatte(checked as boolean)}
                      />
                      <Label htmlFor="matte" className="text-sm cursor-pointer">
                        Matte ({uniqueMatte} colors)
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {chartFormat === 'poster' ? 'Download 48×36 Poster' : 'Download A4 Chart'}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Preview Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {chartFormat === 'poster' ? (
                  <Printer className="h-5 w-5 text-primary" />
                ) : (
                  <LayoutGrid className="h-5 w-5 text-primary" />
                )}
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartFormat === 'poster' ? (
                // Premium Poster Preview - Black Background
                <div className="bg-[#0a0a0f] rounded-lg overflow-hidden border border-blue-500/30 shadow-lg">
                  {/* Mini header - Premium dark design */}
                  <div className="bg-[#0a0a0f] text-white p-4 pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-xl font-bold">
                          <span className="text-blue-400">Ink</span>
                          <span className="text-pink-500">Fusion</span>
                          <span className="text-purple-400 text-sm">™</span>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1">Premium Latex Printed Films</div>
                        <div className="text-[9px] text-pink-500 font-semibold mt-0.5">by DesignProAI™</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-blue-400">WePrintWraps.com</div>
                        <div className="bg-blue-500 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 text-black">50 COLORS</div>
                      </div>
                    </div>
                    <div className="h-0.5 bg-blue-500 mt-3 -mx-4" />
                  </div>
                  
                  {/* Mini color grid - BLACK background with color names */}
                  <div className="p-3 bg-[#0a0a0f]">
                    <div className="flex gap-2">
                      {/* Color swatches grid */}
                      <div className="flex-1 grid grid-cols-10 gap-1">
                        {inkFusionColors
                          .filter((c) => c.finish === 'Gloss')
                          .slice(0, 50)
                          .map((color, i) => (
                            <div key={i} className="flex flex-col items-center">
                              <div
                                className="w-full aspect-square rounded-sm border border-gray-700"
                                style={{ backgroundColor: color.hex }}
                                title={`${color.name}\n${color.hex}`}
                              />
                              <div className="text-[5px] text-white font-medium mt-0.5 text-center truncate w-full px-0.5">
                                {color.name.length > 8 ? color.name.substring(0, 6) + '..' : color.name}
                              </div>
                            </div>
                          ))}
                      </div>
                      {/* Nissan Z showcase mini */}
                      <div className="w-16 bg-[#121216] rounded border border-blue-500/30 p-1.5 flex flex-col items-center justify-center">
                        <div className="text-[6px] text-pink-500 font-bold mb-1">FEATURED</div>
                        <div className="w-12 h-8 bg-[#191920] rounded flex items-center justify-center">
                          <span className="text-[6px] text-gray-600">Nissan Z</span>
                        </div>
                        <div className="text-[6px] text-white font-semibold mt-1">Nissan Z</div>
                        <div className="text-[5px] text-blue-400">Celestial Aqua</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Mini footer - Premium dark */}
                  <div className="bg-[#0a0a0f] p-2 text-center border-t border-blue-500/30">
                    <div className="text-[8px] text-blue-400 font-medium">sales@weprintwraps.com</div>
                    <div className="text-[6px] text-pink-500 mt-0.5">Powered by DesignProAI™</div>
                  </div>
                </div>
              ) : (
                // Standard Chart Preview
                <div className="bg-white rounded-lg p-4 shadow-inner border">
                  <div className="bg-[#0a0a0f] text-white p-3 rounded-t-lg">
                    <div className="text-lg font-bold">InkFusion™</div>
                    <div className="text-xs text-gray-400">Premium Printed Vehicle Wrap Films</div>
                  </div>
                  <div className="p-3 border border-t-0 rounded-b-lg">
                    <div className="text-center mb-3">
                      <div className="text-sm font-bold text-gray-800">
                        InkFusion™ Printed Film Collection
                      </div>
                      <div className="text-xs text-gray-500">
                        Professional Latex Vehicle Wrap Color Samples
                      </div>
                    </div>

                    <div className="space-y-2">
                      {['Bright', 'Mid', 'Dark', 'Neutral'].map((family) => (
                        <div key={family}>
                          <div className="text-xs font-medium text-gray-600 mb-1">{family} Tones</div>
                          <div className="flex gap-1">
                            {inkFusionColors
                              .filter((c) => c.family === family && c.finish === 'Gloss')
                              .slice(0, 6)
                              .map((color) => (
                                <div
                                  key={color.id}
                                  className="w-6 h-4 rounded-sm border border-gray-200"
                                  style={{ backgroundColor: color.hex }}
                                  title={`${color.name} - ${color.hex}`}
                                />
                              ))}
                            {inkFusionColors.filter((c) => c.family === family && c.finish === 'Gloss')
                              .length > 6 && (
                              <div className="w-6 h-4 rounded-sm bg-gray-100 flex items-center justify-center text-[8px] text-gray-400">
                                +
                                {inkFusionColors.filter(
                                  (c) => c.family === family && c.finish === 'Gloss'
                                ).length - 6}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 pt-2 border-t text-center">
                      <div className="text-[8px] text-gray-400">
                        sales@weprintwraps.com • WePrintWraps.com
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <p className="text-xs text-muted-foreground mt-3 text-center">
                {chartFormat === 'poster' 
                  ? '48" × 36" • Premium black background • Large swatches with color names • Nissan Z showcase'
                  : 'A4 format • Multi-page • Organized by color family'
                }
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Color Stats */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Color Library Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-4 bg-primary/10 rounded-lg border border-primary/20">
                <div className="text-2xl font-bold text-primary">50</div>
                <div className="text-sm text-muted-foreground">Base Colors</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">{uniqueGloss}</div>
                <div className="text-sm text-muted-foreground">Gloss</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">{uniqueSatin}</div>
                <div className="text-sm text-muted-foreground">Satin</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">{uniqueMatte}</div>
                <div className="text-sm text-muted-foreground">Matte</div>
              </div>
              <div className="text-center p-4 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">{uniqueGloss + uniqueSatin + uniqueMatte}</div>
                <div className="text-sm text-muted-foreground">Total Options</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Print Specs Card */}
        {chartFormat === 'poster' && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Print Specifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Dimensions</div>
                  <div className="font-semibold">48" × 36" (122cm × 91cm)</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Orientation</div>
                  <div className="font-semibold">Landscape</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Color Values</div>
                  <div className="font-semibold">Hex + CMYK</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Recommended Use</div>
                  <div className="font-semibold">Large Format / Latex Print</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AdminInkFusionSampleChart;
