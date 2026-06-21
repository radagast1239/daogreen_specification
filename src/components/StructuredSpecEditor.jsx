import ProfilePipeCutsEditor from "./ProfilePipeCutsEditor.jsx";
import BreakerSpecsEditor from "./BreakerSpecsEditor.jsx";
import FlowSpecsEditor from "./FlowSpecsEditor.jsx";
import SplitSpecsEditor from "./SplitSpecsEditor.jsx";
import { isProfilePipeName } from "../../shared/profilePipeCuts.js";
import { isRatedAmpsName } from "../../shared/breakerSpecs.js";
import { isFlowSpecName } from "../../shared/flowSpecs.js";
import { isSplitSystemName } from "../../shared/splitSpecs.js";

/** Структурированные поля под тип материала */
export default function StructuredSpecEditor({
  name,
  values = {},
  onChange,
  compact = false,
  disabled = false,
}) {
  const patch = (p) => onChange(p);

  if (isProfilePipeName(name)) {
    return (
      <ProfilePipeCutsEditor
        compact={compact}
        name={name}
        value={values.pipeCuts}
        disabled={disabled}
        onChange={patch}
      />
    );
  }
  if (isRatedAmpsName(name)) {
    return (
      <BreakerSpecsEditor
        compact={compact}
        name={name}
        value={values.breakerSpecs}
        disabled={disabled}
        onChange={patch}
      />
    );
  }
  if (isFlowSpecName(name)) {
    return (
      <FlowSpecsEditor
        compact={compact}
        name={name}
        value={values.flowSpecs}
        disabled={disabled}
        onChange={patch}
      />
    );
  }
  if (isSplitSystemName(name)) {
    return (
      <SplitSpecsEditor
        compact={compact}
        name={name}
        value={values.splitSpecs}
        disabled={disabled}
        onChange={patch}
      />
    );
  }
  return null;
}

export {
  isProfilePipeName,
  isRatedAmpsName,
  isFlowSpecName,
  isSplitSystemName,
};
