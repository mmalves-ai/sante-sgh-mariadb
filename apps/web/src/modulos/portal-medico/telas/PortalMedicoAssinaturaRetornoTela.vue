<script setup lang="ts">
// Volta do provedor do certificado em nuvem (W0-10, M6): `/medico-externo/assinaturas/retorno` (o redirect_uri do
// portal cadastrado no PSC). O cookie do portal é SameSite=Strict, por isso a volta passa por esta tela: com a sessão
// confirmada, ela manda ao servidor UMA vez o state, o código e o erro que vieram na URL (com o CSRF do portal), limpa o
// código da barra de endereço e mostra quantos documentos foram assinados, ficaram pendentes ou foram recusados.
import { MOTIVOS_RECUSA_ASSINATURA, type ResultadoAssinaturaPortalMedico } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { retornoAssinaturaPortalMedico } from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const texto = (v: unknown): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && x ? x : null;
};
// Lidos uma vez: depois do envio a URL é limpa (o código do provedor não fica no histórico).
const state = texto(rota.query.state);
const code = texto(rota.query.code);
const erroProvedor = texto(rota.query.error);
const valido = !!state && /^[A-Za-z0-9_-]{32,128}$/.test(state) && (!!code || !!erroProvedor);

const enviado = ref(false);
const resultado = ref<ResultadoAssinaturaPortalMedico | null>(null);
const erro = ref<unknown>(null);
const textoMotivo = (m: string | null) =>
  (m && (MOTIVOS_RECUSA_ASSINATURA as Record<string, string>)[m]) || null;

async function concluir(): Promise<void> {
  if (enviado.value || !valido || !state) return;
  enviado.value = true;
  try {
    resultado.value = await retornoAssinaturaPortalMedico({
      state,
      code,
      erro: erroProvedor ? erroProvedor.slice(0, 200) : null,
    });
  } catch (e) {
    erro.value = e;
  } finally {
    void Promise.resolve(roteador.replace({ name: 'portal.medico.assinaturasRetorno' })).catch(
      () => undefined,
    );
  }
}
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.assinaturas.retorno.titulo')" @sessao="concluir">
    <template #default>
      <p v-if="!valido" role="alert" data-testid="pm-ret-invalido">
        {{ t('portalMedico.assinaturas.retorno.invalido') }}
      </p>
      <ErroPortalMedico v-else-if="erro" :erro="erro" />
      <p v-else-if="!resultado" role="status" data-testid="pm-ret-concluindo">
        {{ t('portalMedico.assinaturas.retorno.concluindo') }}
      </p>
      <div v-else data-testid="pm-ret-resultado">
        <SanteAlerta
          :variante="resultado.ok ? 'info' : 'alerta'"
          :texto="
            resultado.ok
              ? t('portalMedico.assinaturas.retorno.ok')
              : (textoMotivo(resultado.motivo) ?? t('portalMedico.assinaturas.retorno.falhou'))
          "
        />
        <p data-testid="pm-ret-contagem">
          {{
            t('portalMedico.assinaturas.retorno.contagem', {
              assinados: resultado.assinados,
              pendentes: resultado.pendentes,
              recusados: resultado.recusados,
            })
          }}
        </p>
        <p v-if="resultado.pendentes" class="secundario">
          {{ t('portalMedico.assinaturas.retorno.pendentesAjuda') }}
        </p>
      </div>
      <p class="acoes">
        <RouterLink :to="{ name: 'portal.medico.assinaturas' }" data-testid="pm-ret-voltar">
          {{ t('portalMedico.assinaturas.retorno.voltarLista') }}
        </RouterLink>
      </p>
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
