import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface VehicleSelectorProps {
  onVehicleChange: (vehicle: { year: string; make: string; model: string } | null) => void;
}

export interface VehicleSelectorRef {
  validateYear: () => boolean;
}

export const VehicleSelector = forwardRef<VehicleSelectorRef, VehicleSelectorProps>(
  ({ onVehicleChange }, ref) => {
    const [year, setYear] = useState<string>('');
    const [make, setMake] = useState<string>('');
    const [model, setModel] = useState<string>('');
    const [yearError, setYearError] = useState(false);
    
    const yearInputRef = useRef<HTMLInputElement>(null);

    const validateYear = () => {
      if (!year || year.trim() === '') {
        setYearError(true);
        yearInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        yearInputRef.current?.focus();
        setTimeout(() => setYearError(false), 2000);
        return false;
      }
      return true;
    };

    useImperativeHandle(ref, () => ({
      validateYear
    }));

    const handleYearChange = (value: string) => {
      setYear(value);
      setYearError(false);
      if (value.trim() && make.trim() && model.trim()) {
        onVehicleChange({ year: value, make, model });
      } else {
        onVehicleChange(null);
      }
    };

    const handleMakeChange = (value: string) => {
      setMake(value);
      if (year.trim() && value.trim() && model.trim()) {
        onVehicleChange({ year, make: value, model });
      } else {
        onVehicleChange(null);
      }
    };

    const handleModelChange = (value: string) => {
      setModel(value);
      if (year.trim() && make.trim() && value.trim()) {
        onVehicleChange({ year, make, model: value });
      } else {
        onVehicleChange(null);
      }
    };

    return (
      <div className="space-y-4">
        <div>
          <Label htmlFor="year">Vehicle Year</Label>
          <Input
            ref={yearInputRef}
            id="year"
            type="text"
            placeholder="2024"
            value={year}
            onChange={(e) => handleYearChange(e.target.value)}
            className={cn(
              "transition-all",
              yearError && "border-red-500 animate-pulse"
            )}
          />
        </div>

        <div>
          <Label htmlFor="make">Make</Label>
          <Input
            id="make"
            type="text"
            placeholder="Nissan"
            value={make}
            onChange={(e) => handleMakeChange(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            type="text"
            placeholder="Z"
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
          />
        </div>
      </div>
    );
  }
);