import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Box, LoaderCircle, MousePointerClick, X } from 'lucide-react';
import { getEngine } from '../engine';
import { submitExtrude } from '../engine/controller';
import type {
  ExtrudeExtent,
  ExtrudeOperation,
  PlanarFaceSourceDto,
  ProfileCatalogItemDto,
} from '../engine/types';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import {
  inferExtrudeOperation,
  selectedProfilesFormConnectedRegion,
} from '../lib/extrudeInference';
import { useAppStore } from '../store/appStore';
import { DimensionInput } from './DimensionInput';
import { ExtrudeManipulator } from './viewport/ExtrudeManipulator';

type ExtentType = ExtrudeExtent['type'];

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

/**
 * M2 Extrude editor. The dialog only collects parameters; profile
 * validation, history mutation, recompute, topology naming, and OCCT work
 * remain in the engine/kernel boundary.
 */
export function ExtrudeDialog() {
  const { t } = useTranslation();
  const openFeature = useAppStore((s) => s.extrudeDialogFeature);
  const close = useAppStore((s) => s.closeExtrudeDialog);
  const busy = useAppStore((s) => s.solidBusy);
  const scene = useAppStore((s) => s.solidScene);
  const selectedBody = useAppStore((s) => s.selectedBody);
  const selectedFace = useAppStore((s) => s.selectedFace);
  const profilePicker = useAppStore((s) =>
    s.profilePicker?.owner === 'extrude' ? s.profilePicker : null,
  );
  const configureProfilePicker = useAppStore((s) => s.configureProfilePicker);
  const replaceProfilePicks = useAppStore((s) => s.replaceProfilePicks);
  const toggleProfilePick = useAppStore((s) => s.toggleProfilePick);
  const clearSolidSelection = useAppStore((s) => s.clearSolidSelection);
  const setSelectedBody = useAppStore((s) => s.setSelectedBody);
  const setSelectedFace = useAppStore((s) => s.setSelectedFace);
  const setSolidCommandPreview = useAppStore((s) => s.setSolidCommandPreview);

  const [catalog, setCatalog] = useState<ProfileCatalogItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operation, setOperation] = useState<ExtrudeOperation>('new_body');
  const [extentType, setExtentType] = useState<ExtentType>('distance');
  const [distance, setDistance] = useState('10');
  const [secondDistance, setSecondDistance] = useState('10');
  const [taper, setTaper] = useState('0');
  const [flip, setFlip] = useState(false);
  const [targetBodies, setTargetBodies] = useState<number[]>([]);
  const [toFace, setToFace] = useState<number | null>(null);
  const [operationManual, setOperationManual] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [savedSourceFace, setSavedSourceFace] = useState<PlanarFaceSourceDto | null>(null);
  const [savedSourceBasis, setSavedSourceBasis] = useState<ProfileCatalogItemDto['basis'] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const distanceInputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef<() => void>(() => {});

  const planarFaces = useMemo(
    () =>
      scene.bodies.flatMap((body) =>
        body.faces
          .filter((face) => face.plane !== null)
          .map((face, index) => ({
            bodyId: body.id,
            id: face.id,
            basis: face.plane!,
            label: `${body.name} · ${t('extrude.face')} ${index + 1}`,
          })),
      ),
    [scene, t],
  );
  useEffect(() => {
    if (openFeature === null) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setValidationAttempted(false);
    void getEngine()
      .then(async (engine) => {
        const [nextCatalog, definitions] = await Promise.all([
          engine.profileCatalog(),
          engine.extrudeDefinitions(),
        ]);
        if (cancelled) return;
        const usable = nextCatalog.filter((entry) => entry.profiles.some((profile) => profile.nesting_depth % 2 === 0));
        setCatalog(usable);

        const edit = openFeature > 0
          ? definitions.find((definition) => definition.feature_id === openFeature)
          : undefined;
        const currentlySelectedFace = selectedFace === null
          ? undefined
          : planarFaces.find(
              (face) => face.id === selectedFace
                && (selectedBody === null || face.bodyId === selectedBody),
            );
        const initialSource = edit?.source_face
          ?? (openFeature === 0 && currentlySelectedFace
            ? {
                body_id: currentlySelectedFace.bodyId,
                face_id: currentlySelectedFace.id,
              }
            : null);
        const initialSketch =
          initialSource
            ? ''
            : edit?.sketch_name ??
              usable[usable.length - 1]?.sketch_name ??
              '';
        const entry = usable.find((item) => item.sketch_name === initialSketch);
        const eligible = entry?.profiles.filter((profile) => profile.nesting_depth % 2 === 0) ?? [];
        const initialIndices = edit?.profile_indices ?? (eligible.length === 1 ? [eligible[0].index] : []);
        configureProfilePicker(
          'extrude',
          usable,
          initialIndices.map((profile_index) => ({
            sketch_name: initialSketch,
            profile_index,
          })),
          initialSketch,
        );
        setSavedSourceFace(initialSource);
        setSavedSourceBasis(
          initialSource
            ? edit?.source_face_basis
              ?? planarFaces.find((face) =>
                face.id === initialSource.face_id
                && face.bodyId === initialSource.body_id)?.basis
              ?? null
            : null,
        );
        if (initialSource) {
          setSelectedBody(initialSource.body_id);
          setSelectedFace(initialSource.face_id);
        } else if (openFeature > 0) {
          setSelectedFace(null);
        }
        setOperationManual(false);
        setOperation(edit?.operation ?? (initialSource ? 'join' : 'new_body'));
        setTaper(String(edit?.taper_angle_deg ?? 0));
        setFlip(edit?.flip ?? false);
        setTargetBodies(
          edit?.target_body_ids.length
            ? edit.target_body_ids
            : initialSource
              ? [initialSource.body_id]
            : selectedBody !== null
              ? [selectedBody]
              : scene.bodies[0]
                ? [scene.bodies[0].id]
                : [],
        );

        const extent = edit?.extent ?? { type: 'distance', distance: 10 };
        setExtentType(extent.type);
        if ('distance' in extent) setDistance(String(extent.distance));
        if (extent.type === 'two_sides') setSecondDistance(String(extent.second_distance));
        const preferredFace =
          extent.type === 'to_face'
            ? extent.face_id
            : selectedFace !== null &&
                planarFaces.some((face) => face.id === selectedFace)
              ? selectedFace
              : planarFaces[0]?.id ?? null;
        setToFace(preferredFace);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : t('extrude.loadFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    configureProfilePicker,
    openFeature,
    planarFaces,
    scene.bodies,
    setSelectedBody,
    setSelectedFace,
    t,
  ]);

  const sketchName = profilePicker?.sketchName ?? '';
  const profileIndices = profilePicker?.selected
    .filter((profile) => profile.sketch_name === sketchName)
    .map((profile) => profile.profile_index) ?? [];
  const selectedCatalog = catalog.find((entry) => entry.sketch_name === sketchName);
  const selectedProfiles =
    selectedCatalog?.profiles.filter((profile) => profileIndices.includes(profile.index)) ?? [];
  const selectedPlanarFace = selectedFace === null
    ? undefined
    : planarFaces.find(
        (face) => face.id === selectedFace
          && (selectedBody === null || face.bodyId === selectedBody),
      );
  const sourceFace = useMemo(
    () => profileIndices.length === 0
      ? selectedPlanarFace
        ? { body_id: selectedPlanarFace.bodyId, face_id: selectedPlanarFace.id }
        : savedSourceFace
      : null,
    [profileIndices.length, savedSourceFace, selectedPlanarFace],
  );
  const sourceBasis = selectedCatalog?.basis
    ?? selectedPlanarFace?.basis
    ?? (sourceFace ? savedSourceBasis : null);
  useEffect(() => {
    if (profileIndices.length !== 0 || !selectedPlanarFace) return;
    setSavedSourceFace({
      body_id: selectedPlanarFace.bodyId,
      face_id: selectedPlanarFace.id,
    });
    setSavedSourceBasis(selectedPlanarFace.basis);
  }, [profileIndices.length, selectedPlanarFace]);
  const distanceNumber = Number(distance);
  const secondDistanceNumber = Number(secondDistance);
  const taperNumber = Number(taper);
  const profileSelectionKey = profileIndices.join(',');
  const automaticInference = useMemo(() => {
    if (
      openFeature !== 0 ||
      !selectedCatalog ||
      profileSelectionKey.length === 0
    ) {
      return null;
    }
    if (extentType !== 'distance') {
      return selectedProfilesFormConnectedRegion(
        selectedCatalog.profiles,
        profileIndices,
      )
        ? {
            operation: 'join' as const,
            targetBodyIds: [],
            reason: 'connected_profiles' as const,
          }
        : null;
    }
    if (
      !Number.isFinite(distanceNumber) ||
      Math.abs(distanceNumber) <= 0.000001
    ) {
      return null;
    }
    return inferExtrudeOperation({
      basis: selectedCatalog.basis,
      profiles: selectedCatalog.profiles,
      selectedProfileIndices: profileIndices,
      bodies: scene.bodies,
      signedDistance: distanceNumber * (flip ? -1 : 1),
    });
  }, [
    distanceNumber,
    extentType,
    flip,
    openFeature,
    profileSelectionKey,
    scene.bodies,
    selectedCatalog,
  ]);

  useEffect(() => {
    if (!automaticInference || operationManual) return;
    setOperation(automaticInference.operation);
    setTargetBodies(automaticInference.targetBodyIds);
  }, [automaticInference, operationManual]);

  useEffect(() => {
    if (openFeature !== 0 || operationManual || !sourceFace) return;
    setOperation('join');
    setTargetBodies([sourceFace.body_id]);
  }, [openFeature, operationManual, sourceFace]);

  useEffect(() => {
    if (
      openFeature === null ||
      loading ||
      loadError ||
      !['distance', 'two_sides', 'symmetric'].includes(extentType)
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      distanceInputRef.current?.focus();
      distanceInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [extentType, loadError, loading, openFeature]);

  const booleanOperation = operation !== 'new_body';
  const extentValid = (() => {
    switch (extentType) {
      case 'distance':
        return Number.isFinite(distanceNumber) && Math.abs(distanceNumber) > 0.000001;
      case 'two_sides':
        return (
          Number.isFinite(distanceNumber) &&
          distanceNumber > 0.000001 &&
          Number.isFinite(secondDistanceNumber) &&
          secondDistanceNumber > 0.000001
        );
      case 'symmetric':
        return Number.isFinite(distanceNumber) && distanceNumber > 0.000001;
      case 'through_all':
      case 'to_face':
        return true;
    }
  })();
  const joinsProfilesIntoNewBody =
    operation === 'join' && targetBodies.length === 0 && profileIndices.length > 1;
  const operationValid =
    operation === 'new_body' || targetBodies.length > 0 || joinsProfilesIntoNewBody;
  const canSubmit =
    !loading &&
    !busy &&
    !loadError &&
    (sourceFace !== null || (sketchName.length > 0 && profileIndices.length > 0)) &&
    extentValid &&
    Number.isFinite(taperNumber) &&
    Math.abs(taperNumber) < 89 &&
    operationValid &&
    (extentType !== 'to_face' || toFace !== null);
  const validationError = (() => {
    if (loading || loadError) return null;
    if (!sourceFace && (!sketchName || profileIndices.length === 0)) {
      return t('extrude.validation.selectProfile');
    }
    if (!extentValid) {
      return extentType === 'two_sides'
        ? t('extrude.validation.positiveSideDistances')
        : t('extrude.validation.nonZeroDistance');
    }
    if (!Number.isFinite(taperNumber) || Math.abs(taperNumber) >= 89) {
      return t('extrude.validation.taper');
    }
    if (!operationValid) return t('extrude.validation.targetBody');
    if (extentType === 'to_face' && toFace === null) {
      return t('extrude.validation.targetFace');
    }
    return null;
  })();
  const editFeatureId =
    openFeature !== null && openFeature > 0 ? openFeature : undefined;

  const previewOffsets = useMemo(() => {
    if (
      !sourceBasis
      || (sourceFace === null && selectedProfiles.length === 0)
      || !extentValid
    ) return null;
    let startOffset = 0;
    let endOffset = 0;
    let directionOffset = 0;

    if (extentType === 'distance') {
      const magnitude = Math.abs(distanceNumber);
      const effectiveFlip = distanceNumber < 0 ? !flip : flip;
      startOffset = 0;
      endOffset = magnitude;
      if (effectiveFlip) [startOffset, endOffset] = [-endOffset, -startOffset];
      directionOffset = effectiveFlip ? -magnitude : magnitude;
    } else if (extentType === 'two_sides') {
      startOffset = -secondDistanceNumber;
      endOffset = distanceNumber;
      if (flip) [startOffset, endOffset] = [-endOffset, -startOffset];
      directionOffset = flip ? -secondDistanceNumber : distanceNumber;
    } else if (extentType === 'symmetric') {
      const half = distanceNumber * 0.5;
      startOffset = -half;
      endOffset = half;
      directionOffset = flip ? -half : half;
    } else if (extentType === 'to_face') {
      const faceBasis = scene.bodies
        .flatMap((body) => body.faces)
        .find((face) => face.id === toFace)?.plane;
      if (!faceBasis) return null;
      const delta = faceBasis.origin.map(
        (coordinate, index) => coordinate - sourceBasis.origin[index],
      );
      const distanceToFace = delta.reduce(
        (sum, coordinate, index) =>
          sum + coordinate * sourceBasis.normal[index],
        0,
      );
      if (!Number.isFinite(distanceToFace) || Math.abs(distanceToFace) <= 0.000001) {
        return null;
      }
      startOffset = 0;
      endOffset = distanceToFace;
      if (flip) [startOffset, endOffset] = [-endOffset, -startOffset];
      directionOffset = flip ? -distanceToFace : distanceToFace;
    } else {
      // Through All is infinite in the kernel. Bound its presentation to the
      // active target geometry so the preview stays useful and numerically
      // compact in the native viewport.
      const eligibleIds = new Set(
        targetBodies.length > 0
          ? targetBodies
          : scene.bodies.map((body) => body.id),
      );
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const body of scene.bodies) {
        if (!eligibleIds.has(body.id)) continue;
        for (let index = 0; index + 2 < body.mesh.positions.length; index += 3) {
          const projection =
            (body.mesh.positions[index] - sourceBasis.origin[0])
              * sourceBasis.normal[0]
            + (body.mesh.positions[index + 1] - sourceBasis.origin[1])
              * sourceBasis.normal[1]
            + (body.mesh.positions[index + 2] - sourceBasis.origin[2])
              * sourceBasis.normal[2];
          minimum = Math.min(minimum, projection);
          maximum = Math.max(maximum, projection);
        }
      }
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
        minimum = -50;
        maximum = 50;
      }
      const padding = Math.max(2, Math.abs(maximum - minimum) * 0.08);
      startOffset = minimum - padding;
      endOffset = maximum + padding;
      directionOffset = flip ? startOffset : endOffset;
    }

    return { startOffset, endOffset, directionOffset };
  }, [
    distanceNumber,
    extentType,
    extentValid,
    flip,
    scene.bodies,
    secondDistanceNumber,
    selectedProfiles.length,
    sourceBasis,
    sourceFace,
    targetBodies,
    toFace,
  ]);

  // OCCT-scale previews should not run for every intermediate keystroke. Keep
  // the previous valid tool volume while typing, then publish one coherent
  // update after a short pause.
  useEffect(() => {
    if (
      openFeature === null ||
      loading ||
      loadError ||
      !sourceBasis ||
      (sourceFace === null && profileIndices.length === 0)
    ) {
      setSolidCommandPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (
        !previewOffsets
        || !Number.isFinite(taperNumber)
        || Math.abs(taperNumber) >= 89
      ) {
        setSolidCommandPreview(null);
        return;
      }
      setSolidCommandPreview({
        kind: 'extrude',
        basis: sourceBasis,
        sourceFace,
        profiles: selectedCatalog?.profiles ?? [],
        selectedProfileIndices: [...profileIndices],
        startOffset: previewOffsets.startOffset,
        endOffset: previewOffsets.endOffset,
        directionOffset: previewOffsets.directionOffset,
        operation,
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    loadError,
    loading,
    openFeature,
    operation,
    previewOffsets,
    profileSelectionKey,
    selectedCatalog,
    setSolidCommandPreview,
    sourceBasis,
    sourceFace,
    taperNumber,
  ]);

  useEffect(
    () => () => setSolidCommandPreview(null),
    [setSolidCommandPreview],
  );

  const changeDistance = (value: string) => {
    setDistance(value);
  };

  const changeFlip = (value: boolean) => {
    setFlip(value);
  };

  const chooseOperation = (value: ExtrudeOperation) => {
    setOperationManual(true);
    setOperation(value);
  };

  const chooseSketch = (name: string) => {
    if (name === '') {
      clearSolidSelection();
      setSavedSourceFace(null);
      setSavedSourceBasis(null);
      replaceProfilePicks('extrude', [], '');
      return;
    }
    clearSolidSelection();
    setSavedSourceFace(null);
    setSavedSourceBasis(null);
    const entry = catalog.find((item) => item.sketch_name === name);
    const eligible = entry?.profiles.filter((profile) => profile.nesting_depth % 2 === 0) ?? [];
    replaceProfilePicks(
      'extrude',
      eligible.length === 1
        ? [{ sketch_name: name, profile_index: eligible[0].index }]
        : [],
      name,
    );
  };

  const toggleProfile = (profileSketchName: string, index: number) => {
    clearSolidSelection();
    setSavedSourceFace(null);
    setSavedSourceBasis(null);
    toggleProfilePick({ sketch_name: profileSketchName, profile_index: index });
  };

  const toggleBody = (id: number) => {
    setOperationManual(true);
    setTargetBodies((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  };

  const commit = () => {
    if (!canSubmit) {
      setValidationAttempted(true);
      return;
    }
    setValidationAttempted(false);
    const distanceValue = distanceNumber;
    const secondDistanceValue = secondDistanceNumber;
    let requestFlip = flip;
    let extent: ExtrudeExtent;
    switch (extentType) {
      case 'distance':
        if (distanceValue < 0) requestFlip = !requestFlip;
        extent = { type: 'distance', distance: Math.abs(distanceValue) };
        break;
      case 'two_sides':
        extent = {
          type: 'two_sides',
          distance: distanceValue,
          second_distance: secondDistanceValue,
        };
        break;
      case 'symmetric':
        extent = { type: 'symmetric', distance: distanceValue };
        break;
      case 'through_all':
        extent = { type: 'through_all' };
        break;
      case 'to_face':
        if (toFace === null) return;
        extent = { type: 'to_face', face_id: toFace };
        break;
    }
    void submitExtrude(
      {
        source_face: sourceFace,
        sketch_name: sketchName,
        profile_indices: profileIndices,
        operation,
        extent,
        taper_angle_deg: taperNumber,
        flip: requestFlip,
        target_body_ids: booleanOperation ? targetBodies : [],
      },
      editFeatureId,
    );
  };
  commitRef.current = commit;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    commit();
  };

  useEffect(() => {
    if (openFeature === null) return;
    const acceptOnEnter = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (useAppStore.getState().constraintDialog) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (
        target instanceof HTMLButtonElement &&
        formRef.current?.contains(target) &&
        target.type !== 'submit'
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!useAppStore.getState().solidBusy) commitRef.current();
    };
    window.addEventListener('keydown', acceptOnEnter, true);
    return () => window.removeEventListener('keydown', acceptOnEnter, true);
  }, [openFeature]);

  const operationChoices: Array<{ value: ExtrudeOperation; label: string }> = [
    { value: 'new_body', label: t('extrude.newBody') },
    { value: 'join', label: t('extrude.joinCombine') },
    { value: 'cut', label: t('extrude.cut') },
    { value: 'intersect', label: t('extrude.intersect') },
  ];
  const operationHint =
    operation === 'new_body'
      ? profileIndices.length > 1
        ? t('extrude.newBodyMultipleHint')
        : t('extrude.newBodyHint')
      : operation === 'join'
        ? targetBodies.length > 0
          ? t('extrude.joinTargetHint')
          : t('extrude.joinProfilesHint')
        : operation === 'cut'
          ? t('extrude.cutHint')
          : t('extrude.intersectHint');
  const automaticTargetNames =
    automaticInference?.targetBodyIds
      .map((id) => scene.bodies.find((body) => body.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ') ?? '';
  const automaticHint =
    openFeature === 0 && !operationManual && automaticInference
      ? automaticInference.reason === 'connected_profiles'
        ? t('extrude.autoJoinProfilesHint')
        : automaticInference.reason === 'volume_intersection'
        ? `${t('extrude.autoCutHint')} ${automaticTargetNames}`
        : automaticInference.reason === 'outward_contact'
          ? `${t('extrude.autoJoinHint')} ${automaticTargetNames}`
          : t('extrude.autoNewBodyHint')
      : null;
  const sourceFaceLabel = sourceFace
    ? planarFaces.find(
        (face) => face.id === sourceFace.face_id && face.bodyId === sourceFace.body_id,
      )?.label ?? `${t('extrude.face')} #${sourceFace.face_id}`
    : null;

  if (openFeature === null) return null;

  return (
    <div
      data-native-viewport-dim="0.15"
      className="pointer-events-none fixed inset-0 z-[70] bg-black/15"
    >
      {selectedCatalog && selectedProfiles.length > 0 && extentType === 'distance' && (
        <ExtrudeManipulator
          basis={selectedCatalog.basis}
          profiles={selectedProfiles}
          distance={distance}
          flip={flip}
          disabled={loading || busy}
          onDistanceChange={changeDistance}
          onCommit={commit}
        />
      )}
      <form
        ref={formRef}
        data-testid="extrude-dialog"
        onSubmit={submit}
        className="feature-dialog pointer-events-auto absolute right-5 top-[132px] flex max-h-[calc(100vh-190px)] w-80 flex-col overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <Box size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            {openFeature > 0 ? t('extrude.editTitle') : t('extrude.title')}
          </span>
          <button
            type="button"
            title={t('extrude.cancel')}
            disabled={busy}
            onClick={close}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-mute">
              <LoaderCircle size={14} className="animate-spin" />
              {t('extrude.loading')}
            </div>
          ) : loadError ? (
            <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {loadError}
            </p>
          ) : catalog.length === 0 && planarFaces.length === 0 ? (
            <p className="rounded border border-edge bg-header p-2 text-xs leading-5 text-mute">
              {t('extrude.noProfiles')}
            </p>
          ) : (
            <>
              <label>
                <span className={LABEL_CLASS}>{t('extrude.sketch')}</span>
                <select
                  data-testid="extrude-sketch"
                  value={sketchName}
                  onChange={(event) => chooseSketch(event.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">{t('extrude.anyVisibleSketch')}</option>
                  {catalog.map((entry) => (
                    <option key={entry.sketch_name} value={entry.sketch_name}>
                      {entry.sketch_name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className={LABEL_CLASS}>{t('extrude.sources')}</legend>
                <div
                  data-testid="extrude-profile-selection-state"
                  className="mb-2 rounded border border-accent/70 bg-accent/10 p-2"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                    <MousePointerClick size={14} className="shrink-0 text-accent" />
                    <span className="flex-1">{t('extrude.selectingSources')}</span>
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                      {t('extrude.selectedSourceCount').replace(
                        '{count}',
                        String(sourceFace ? 1 : profileIndices.length),
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-mute">
                    {t('extrude.selectingSourcesHint')}
                  </p>
                  <button
                    type="button"
                    data-testid="extrude-clear-profiles"
                    disabled={!sourceFace && profileIndices.length === 0 && sketchName === ''}
                    onClick={() => {
                      clearSolidSelection();
                      setSavedSourceFace(null);
                      setSavedSourceBasis(null);
                      replaceProfilePicks('extrude', [], '');
                    }}
                    className="mt-1.5 h-6 rounded border border-edge bg-header px-2 text-[10px] text-ink hover:border-accent/70 hover:bg-edge disabled:opacity-40"
                  >
                    {t('extrude.clearAndReselect')}
                  </button>
                </div>
                <div className="space-y-1 rounded border border-edge bg-header p-2">
                  {sourceFace && sourceFaceLabel && (
                    <label className="flex cursor-pointer items-center gap-2 rounded bg-accent/10 px-1 py-1 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => {
                          clearSolidSelection();
                          setSavedSourceFace(null);
                          setSavedSourceBasis(null);
                        }}
                        className="accent-accent"
                      />
                      <span className="flex-1">{sourceFaceLabel}</span>
                      <span className="text-[10px] text-accent">
                        {t('extrude.exactFace')}
                      </span>
                    </label>
                  )}
                  {(selectedCatalog ? [selectedCatalog] : catalog).map((entry) => (
                    <div key={entry.sketch_name}>
                      {!selectedCatalog && (
                        <div className="px-1 pb-1 pt-1 text-[10px] font-semibold text-mute">
                          {entry.sketch_name}
                        </div>
                      )}
                      {entry.profiles
                        .filter((profile) => profile.nesting_depth % 2 === 0)
                        .map((profile) => {
                          const checked = profilePicker?.selected.some(
                            (candidate) =>
                              candidate.sketch_name === entry.sketch_name
                              && candidate.profile_index === profile.index,
                          ) ?? false;
                          return (
                            <label
                              key={`${entry.sketch_name}:${profile.index}`}
                              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleProfile(entry.sketch_name, profile.index)}
                                className="accent-accent"
                              />
                              <span className="flex-1">
                                {t('extrude.profile')} {profile.index + 1}
                              </span>
                              <span className="text-[10px] text-mute">
                                {Math.abs(profile.area).toFixed(2)} mm²
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-mute">
                  {t('extrude.livePreview')}
                </p>
              </fieldset>

              <fieldset>
                <legend className={LABEL_CLASS}>{t('extrude.operation')}</legend>
                <select
                  data-testid="extrude-operation"
                  aria-hidden="true"
                  tabIndex={-1}
                  value={operation}
                  onChange={(event) =>
                    chooseOperation(event.target.value as ExtrudeOperation)
                  }
                  className="sr-only"
                >
                  <option value="new_body">{t('extrude.newBody')}</option>
                  <option value="join">{t('extrude.join')}</option>
                  <option value="cut">{t('extrude.cut')}</option>
                  <option value="intersect">{t('extrude.intersect')}</option>
                </select>
                <div
                  role="radiogroup"
                  aria-label={t('extrude.operation')}
                  className="grid grid-cols-2 gap-1"
                >
                  {operationChoices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={operation === choice.value}
                      data-extrude-operation={choice.value}
                      onClick={() => chooseOperation(choice.value)}
                      className={cx(
                        'h-8 rounded border px-2 text-[11px] font-medium transition-colors',
                        operation === choice.value
                          ? 'border-accent bg-accent/20 text-ink'
                          : 'border-edge bg-header text-mute hover:border-accent/60 hover:bg-edge hover:text-ink',
                      )}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-mute">{operationHint}</p>
                {automaticHint && (
                  <p
                    data-testid="extrude-auto-operation"
                    className="mt-1 text-[10px] leading-4 text-accent"
                  >
                    {automaticHint}
                  </p>
                )}
              </fieldset>

              {booleanOperation && (
                <fieldset>
                  <legend className={LABEL_CLASS}>{t('extrude.targetBodies')}</legend>
                  <div className="space-y-1 rounded border border-edge bg-header p-2">
                    {scene.bodies.length === 0 ? (
                      <p className="text-xs text-mute">
                        {operation === 'join' && profileIndices.length > 1
                          ? t('extrude.joinProfilesNoTarget')
                          : t('extrude.noTargetBodies')}
                      </p>
                    ) : (
                      scene.bodies.map((body) => (
                        <label
                          key={body.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                        >
                          <input
                            type="checkbox"
                            checked={targetBodies.includes(body.id)}
                            onChange={() => toggleBody(body.id)}
                            className="accent-accent"
                          />
                          {body.name}
                        </label>
                      ))
                    )}
                  </div>
                  {joinsProfilesIntoNewBody && (
                    <p className="mt-1 text-[10px] leading-4 text-accent">
                      {t('extrude.joinProfilesNoTarget')}
                    </p>
                  )}
                </fieldset>
              )}

              <label>
                <span className={LABEL_CLASS}>{t('extrude.extent')}</span>
                <select
                  data-testid="extrude-extent"
                  value={extentType}
                  onChange={(event) => setExtentType(event.target.value as ExtentType)}
                  className={INPUT_CLASS}
                >
                  <option value="distance">{t('extrude.distance')}</option>
                  <option value="two_sides">{t('extrude.twoSides')}</option>
                  <option value="symmetric">{t('extrude.symmetric')}</option>
                  <option value="through_all">{t('extrude.throughAll')}</option>
                  <option value="to_face">{t('extrude.toFace')}</option>
                </select>
              </label>

              {extentType !== 'through_all' && extentType !== 'to_face' && (
                <div className={cx('grid gap-2', extentType === 'two_sides' && 'grid-cols-2')}>
                  <label>
                    <span className={LABEL_CLASS}>
                      {extentType === 'symmetric'
                        ? t('extrude.totalDistance')
                        : extentType === 'two_sides'
                          ? t('extrude.firstDistance')
                          : t('extrude.distance')}
                    </span>
                    <DimensionInput
                      ref={distanceInputRef}
                      data-testid="extrude-distance"
                      min={extentType === 'distance' ? undefined : '0.000001'}
                      step="any"
                      value={distance}
                      onValueChange={changeDistance}
                    />
                  </label>
                  {extentType === 'two_sides' && (
                    <label>
                      <span className={LABEL_CLASS}>{t('extrude.secondDistance')}</span>
                      <DimensionInput
                        data-testid="extrude-second-distance"
                        min="0.000001"
                        step="any"
                        value={secondDistance}
                        onValueChange={setSecondDistance}
                      />
                    </label>
                  )}
                </div>
              )}

              {extentType === 'to_face' && (
                <label>
                  <span className={LABEL_CLASS}>{t('extrude.targetFace')}</span>
                  <select
                    value={toFace ?? ''}
                    onChange={(event) => setToFace(Number(event.target.value))}
                    className={INPUT_CLASS}
                  >
                    <option value="" disabled>
                      {t('extrude.chooseFace')}
                    </option>
                    {planarFaces.map((face) => (
                      <option key={face.id} value={face.id}>
                        {face.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                <span className={LABEL_CLASS}>{t('extrude.taper')}</span>
                <DimensionInput
                  step="any"
                  value={taper}
                  onValueChange={setTaper}
                />
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={flip}
                  onChange={(event) => changeFlip(event.target.checked)}
                  className="accent-accent"
                />
                {t('extrude.flip')}
              </label>
            </>
          )}
        </div>

        {validationAttempted && validationError && (
          <p
            data-testid="extrude-validation-error"
            role="alert"
            className="mx-3 mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[10px] leading-4 text-red-300"
          >
            {validationError}
          </p>
        )}

        <footer className="flex shrink-0 justify-end gap-2 border-t border-edge bg-header px-3 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="h-7 rounded border border-edge px-3 text-xs text-mute hover:bg-edge hover:text-ink disabled:opacity-40"
          >
            {t('extrude.cancel')}
          </button>
          <button
            data-testid="extrude-submit"
            type="submit"
            disabled={loading || busy || Boolean(loadError) || catalog.length === 0}
            className="flex h-7 min-w-16 items-center justify-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <LoaderCircle size={12} className="animate-spin" />}
            {t('extrude.ok')}
          </button>
        </footer>
      </form>
    </div>
  );
}
