import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { installAOResourceCleanup } from './aoResources';

/** AO is in world metres. No depth-of-field blur or frame accumulation during navigation. */
export default function RenderEffects3D({ contactShadows }: { contactShadows: boolean }) {
  return (
    <EffectComposer multisampling={0}>
      <N8AO
        ref={(pass) => {
          if (pass) installAOResourceCleanup(pass);
        }}
        enabled={contactShadows}
        aoRadius={0.55}
        intensity={1.35}
        distanceFalloff={0.5}
        quality="medium"
        halfRes
        depthAwareUpsampling
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}
