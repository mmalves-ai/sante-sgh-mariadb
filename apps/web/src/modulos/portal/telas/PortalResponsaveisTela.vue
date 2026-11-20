<script setup lang="ts">
// Portal do paciente: responsável legal e consentimentos (M50, etapa 1; ficha, seção 7; regra 5; LGPD art. 14). O
// responsável pede o acesso de quem representa (filho menor, tutelado, curatelado, procuração) com o documento que prova o
// vínculo: o hospital confere o original antes de liberar. O titular vê quem tem acesso aos dados dele e revoga o
// procurador. Os consentimentos por finalidade: "seu atendimento" só aparece (não depende de consentimento); as demais o
// titular (ou o representante, no escopo) dá, nega ou retira. Todos os combos com busca (SanteSelecao, ADR 0027).
import {
  type ConsentimentoPortalItem,
  FINALIDADES_CONSENTIMENTO_PORTAL,
  PROVAS_ACEITAS,
  type ProvaVinculo,
  type SessaoContaPortal,
  TIPOS_VINCULO_RESPONSAVEL,
  type TipoVinculoResponsavel,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  arquivoParaEnvio,
  consentimentosPortal,
  enviarProva,
  estabelecimentoPortal,
  pedirVinculo,
  registrarConsentimentoPortal,
  revogarVinculo,
  vinculosPortal,
} from '../api-portal-paciente.js';
import PortalCasca from '../componentes/PortalCasca.vue';

const { t } = useI18n();
const sessao = ref<SessaoContaPortal | null>(null);
const versao = ref(0);
const pronta = computed(() => sessao.value !== null);
const vinculos = useQuery({
  queryKey: computed(() => ['portal-paciente', 'vinculos', versao.value]),
  queryFn: () => vinculosPortal(),
  enabled: pronta,
});
const podeConsentir = computed(() => sessao.value?.ativo.escopos.includes('consentimentos') ?? false);
const consentimentos = useQuery({
  queryKey: computed(() => [
    'portal-paciente',
    'consentimentos',
    versao.value,
    sessao.value?.ativo.vinculo ?? '',
  ]),
  queryFn: () => consentimentosPortal(),
  enabled: podeConsentir,
});
const versaoTermo = ref('');
void estabelecimentoPortal()
  .then((e) => (versaoTermo.value = e.consentimento))
  .catch(() => undefined);

// Pedido de vínculo
const prontuario = ref('');
const nascimento = ref('');
const tipo = ref<TipoVinculoResponsavel>('pai-mae');
const prova = ref<ProvaVinculo>('certidao-nascimento');
const validade = ref('');
const arquivo = ref<File | null>(null);
const enviado = ref(false);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const opcoesTipo = computed(() =>
  TIPOS_VINCULO_RESPONSAVEL.map((v) => ({ valor: v, rotulo: t(`portal.responsaveis.tipos.${v}`) })),
);
const opcoesProva = computed(() =>
  PROVAS_ACEITAS[tipo.value].map((v) => ({ valor: v, rotulo: t(`portal.responsaveis.provas.${v}`) })),
);
watch(tipo, (x) => (prova.value = PROVAS_ACEITAS[x][0] as ProvaVinculo));
const comValidade = computed(() => tipo.value === 'procurador');

function escolher(e: Event): void {
  arquivo.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function pedir(): Promise<void> {
  erro.value = null;
  enviado.value = false;
  if (!arquivo.value) return;
  ocupado.value = true;
  try {
    const a = await arquivoParaEnvio(arquivo.value);
    const { arquivo: chave } = await enviarProva(a.tipo, a.conteudo);
    await pedirVinculo({
      prontuario: Number(prontuario.value),
      nascimento: nascimento.value,
      tipo: tipo.value,
      prova: prova.value,
      arquivo: chave,
      validade: comValidade.value && validade.value ? validade.value : null,
    });
    enviado.value = true;
    prontuario.value = '';
    nascimento.value = '';
    arquivo.value = null;
    versao.value++;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

async function revogar(v: string): Promise<void> {
  erro.value = null;
  try {
    await revogarVinculo(v);
    versao.value++;
  } catch (x) {
    erro.value = x;
  }
}

/** A decisão vigente de cada finalidade (a mais recente não retirada). */
const vigentes = computed(() => {
  const r = new Map<string, ConsentimentoPortalItem>();
  for (const c of consentimentos.data.value ?? [])
    if (!c.revogadoEm && !r.has(c.finalidade)) r.set(c.finalidade, c);
  return r;
});
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

async function consentir(finalidade: string, acao: 'consentir' | 'nao-consentir'): Promise<void> {
  erro.value = null;
  try {
    await registrarConsentimentoPortal({ acao, finalidade, versao: versaoTermo.value });
    await consentimentos.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function retirar(consentimento: number): Promise<void> {
  erro.value = null;
  try {
    await registrarConsentimentoPortal({ acao: 'revogar', consentimento });
    await consentimentos.refetch();
  } catch (x) {
    erro.value = x;
  }
}
function trocou(s: SessaoContaPortal): void {
  sessao.value = s;
  versao.value++;
}
</script>

<template>
  <PortalCasca :titulo="t('portal.responsaveis.titulo')" @sessao="(s) => (sessao = s)" @trocou="trocou">
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel" aria-labelledby="pac-meus" data-testid="portal-meus-vinculos">
      <h2 id="pac-meus">{{ t('portal.responsaveis.meus') }}</h2>
      <p v-if="!vinculos.data.value?.meus.length">{{ t('portal.nenhum') }}</p>
      <ul v-else>
        <li
          v-for="v in vinculos.data.value.meus"
          :key="v.vinculo"
          :data-testid="`portal-vinculo-${v.vinculo}`"
        >
          {{ v.primeiroNomeOutro || t('portal.responsaveis.semNome') }} ·
          {{ t(`portal.responsaveis.tipos.${v.tipo}`) }} ·
          <strong>{{ t(`portal.responsaveis.situacoes.${v.situacao}`) }}</strong>
          <span v-if="v.terminaEm && v.situacao === 'ativo'">
            · {{ t('portal.responsaveis.terminaEm', { dia: dia(v.terminaEm) }) }}</span
          >
          <span v-if="v.motivoFim"> · {{ t(`portal.responsaveis.fim.${v.motivoFim}`) }}</span>
        </li>
      </ul>
      <SanteAlerta v-if="vinculos.data.value?.recusa" :texto="vinculos.data.value.recusa" variante="aviso" />
    </section>
    <section
      v-if="!sessao?.soResponsavel"
      class="portal-painel"
      aria-labelledby="pac-demim"
      data-testid="portal-de-mim"
    >
      <h2 id="pac-demim">{{ t('portal.responsaveis.deMim') }}</h2>
      <p v-if="!vinculos.data.value?.deMim.length">{{ t('portal.nenhum') }}</p>
      <ul v-else>
        <li v-for="v in vinculos.data.value.deMim" :key="v.vinculo">
          {{ v.primeiroNomeOutro }} · {{ t(`portal.responsaveis.tipos.${v.tipo}`) }} ·
          {{ t(`portal.responsaveis.situacoes.${v.situacao}`) }}
          <SanteBotao
            v-if="v.tipo === 'procurador'"
            variante="destrutivo"
            :rotulo="t('portal.responsaveis.revogar')"
            :confirmacao="t('portal.responsaveis.revogarConfirma')"
            @acionar="revogar(v.vinculo)"
          />
        </li>
      </ul>
    </section>
    <form
      class="portal-painel"
      aria-labelledby="pac-pedir"
      data-testid="portal-pedir-vinculo"
      @submit.prevent="pedir"
    >
      <h2 id="pac-pedir">{{ t('portal.responsaveis.pedir') }}</h2>
      <p>{{ t('portal.responsaveis.pedirAjuda') }}</p>
      <span class="portal-campo">
        <label for="pac-prontuario">{{ t('portal.responsaveis.prontuario') }}</label>
        <input id="pac-prontuario" v-model="prontuario" inputmode="numeric" data-testid="pac-prontuario" />
      </span>
      <span class="portal-campo">
        <label for="pac-nasc-rep">{{ t('portal.responsaveis.nascimento') }}</label>
        <input id="pac-nasc-rep" v-model="nascimento" type="date" data-testid="pac-nascimento-rep" />
      </span>
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('portal.responsaveis.tipo')"
        :opcoes="opcoesTipo"
        :busca="true"
        data-testid="pac-tipo"
      />
      <SanteSelecao
        v-model="prova"
        :rotulo="t('portal.responsaveis.prova')"
        :opcoes="opcoesProva"
        :busca="true"
        data-testid="pac-prova"
      />
      <span v-if="comValidade" class="portal-campo">
        <label for="pac-validade">{{ t('portal.responsaveis.validade') }}</label>
        <input id="pac-validade" v-model="validade" type="date" data-testid="pac-validade" />
      </span>
      <span class="portal-campo">
        <label for="pac-arquivo">{{ t('portal.responsaveis.enviarArquivo') }}</label>
        <input
          id="pac-arquivo"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          data-testid="pac-arquivo"
          @change="escolher"
        />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="t('portal.responsaveis.pedir')"
        :desabilitado="ocupado || !arquivo || !prontuario || !nascimento"
        data-testid="pac-pedir"
        @acionar="pedir"
      />
      <SanteAlerta
        v-if="enviado"
        :texto="t('portal.responsaveis.enviado')"
        variante="info"
        anunciar
        data-testid="pac-pedido-enviado"
      />
    </form>
    <section class="portal-painel" aria-labelledby="pac-consent" data-testid="portal-consentimentos">
      <h2 id="pac-consent">{{ t('portal.consentimentos.titulo') }}</h2>
      <p>{{ t('portal.consentimentos.ajuda') }}</p>
      <p v-if="!podeConsentir">{{ t('portal.consentimentos.semEscopo') }}</p>
      <template v-else>
        <p>
          <strong>{{ t('portal.consentimentos.finalidades.atendimento') }}</strong> ·
          {{ t('portal.consentimentos.atendimentoAjuda') }}
        </p>
        <div
          v-for="f in FINALIDADES_CONSENTIMENTO_PORTAL"
          :key="f"
          class="portal-consentimento"
          :data-testid="`pac-consent-${f}`"
        >
          <strong>{{ t(`portal.consentimentos.finalidades.${f}`) }}</strong>
          <span v-if="vigentes.get(f)" class="portal-secundario">
            {{
              vigentes.get(f)!.consentiu
                ? t('portal.consentimentos.situacao.sim', { dia: dia(vigentes.get(f)!.registradoEm) })
                : t('portal.consentimentos.situacao.nao', { dia: dia(vigentes.get(f)!.registradoEm) })
            }}
            <template v-if="vigentes.get(f)!.signatario === 'representante-legal'">
              · {{ t('portal.consentimentos.porRepresentante') }}</template
            >
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('portal.consentimentos.consentir')"
            :data-testid="`pac-consentir-${f}`"
            @acionar="consentir(f, 'consentir')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portal.consentimentos.naoConsentir')"
            @acionar="consentir(f, 'nao-consentir')"
          />
          <SanteBotao
            v-if="vigentes.get(f)"
            variante="destrutivo"
            :rotulo="t('portal.consentimentos.revogar')"
            :confirmacao="t('portal.consentimentos.revogarConfirma')"
            @acionar="retirar(vigentes.get(f)!.consentimento)"
          />
        </div>
        <p class="portal-secundario">{{ t('portal.consentimentos.versaoTermo', { versao: versaoTermo }) }}</p>
      </template>
    </section>
  </PortalCasca>
</template>

<style scoped>
.portal-consentimento {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
