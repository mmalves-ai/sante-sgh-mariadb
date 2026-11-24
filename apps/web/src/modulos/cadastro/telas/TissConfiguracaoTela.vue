<script setup lang="ts">
// Configuração TISS por fonte pagadora (F3.1, 02-CAD linha 25): escolhida a fonte pagadora, a tela mostra as
// vigências (a atual aberta para edição; a nova vigência parte da atual com um clique e encerra a anterior na
// véspera) e as faixas de números de guia com o consumo (usados, restantes e o aviso de faixa no fim). As regras
// incoerentes (reapresentação sem faturamento eletrônico, lote acima de 100, contratado incompleto) aparecem na hora;
// a API confere de novo pela regra do domínio. Encerrar a faixa pede motivo e nunca apaga.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  type Corpo,
  encerrarFaixa,
  gravarConfiguracaoTiss,
  incluirFaixa,
  lerPainelTiss,
} from '../api-estrutura.js';

const { t } = useI18n();
const cliente = useQueryClient();
const fonte = ref<number | null>(null);
const chaveQ = computed(() => ['cadastro', 'tiss-configuracao', fonte.value]);
const consulta = useQuery({ queryKey: chaveQ, queryFn: () => lerPainelTiss(fonte.value) });
const p = computed(() => consulta.data.value);
const erro = ref<unknown>(null);
const ok = ref(false);

async function fazer(fn: () => Promise<unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    depois?.();
    await cliente.invalidateQueries({ queryKey: ['cadastro', 'tiss-configuracao'] });
  } catch (e) {
    erro.value = e;
  }
}

const SIMS = [
  'agrupaProcedimentoMaiorData',
  'agrupaItensIguais',
  'separaProfissionalPorGuia',
  'omiteGuiaSemValor',
  'somenteArquivo',
  'imprimeVersoGuia',
  'exigeCidAlta',
  'informaCid',
] as const;
const ELETRONICOS = [
  'exigeElegibilidade',
  'elegibilidadeEletronica',
  'autorizacaoEletronica',
  'faturamentoEletronico',
  'retornoEletronico',
  'reapresentacaoEletronica',
  'consideraPagoItemSemRetorno',
] as const;
const PADRAO: Corpo = {
  id: null,
  versaoPadrao: null,
  vigenciaInicio: new Date().toISOString().slice(0, 10),
  vigenciaFim: null,
  identificacaoPrestador: 'codigo_operadora',
  numeracaoGuia: 'prestador',
  ordenacaoGuias: 'numero',
  quebraResumoInternacao: 'nao_quebra',
  limiteGuiasLote: 100,
  omiteGuiaSemValor: true,
  informaCid: true,
  faturamentoEletronico: true,
};
const cfg = ref<Corpo | null>(null);
watch(p, (x) => {
  cfg.value = x?.configuracoes[0] ? { ...x.configuracoes[0] } : null;
});
/** Nova vigência a partir da atual (um clique): copia as regras e só pede a data de início. */
function novaVigencia(): void {
  const atual = p.value?.configuracoes[0];
  cfg.value = {
    ...(atual ?? PADRAO),
    id: null,
    versao: null,
    vigenciaInicio: new Date().toISOString().slice(0, 10),
    vigenciaFim: null,
  };
}
/** Os mesmos avisos do domínio, na hora. */
const avisos = computed(() => {
  const c = cfg.value;
  if (!c) return [];
  const a: string[] = [];
  const lim = Number(c['limiteGuiasLote'] ?? 0);
  if (c['limiteGuiasLote'] !== null && c['limiteGuiasLote'] !== '' && (lim < 1 || lim > 100))
    a.push('limiteGuiasLote');
  if (c['registroAns'] && !/^\d{6}$/.test(String(c['registroAns']))) a.push('registroAns');
  if (c['identificacaoPrestador'] === 'codigo_operadora' && !c['codigoPrestadorOperadora'])
    a.push('codigoPrestadorOperadora');
  if (!!c['cnpjContratado'] !== !!c['razaoSocialContratado']) a.push('razaoSocialContratado');
  if (
    !c['faturamentoEletronico'] &&
    (c['reapresentacaoEletronica'] || c['retornoEletronico'] || c['somenteArquivo'])
  )
    a.push('faturamentoEletronico');
  if (c['elegibilidadeEletronica'] && !c['exigeElegibilidade']) a.push('elegibilidadeEletronica');
  if (c['somenteArquivo'] && c['imprimeVersoGuia']) a.push('imprimeVersoGuia');
  return a;
});

const faixa = ref<Corpo | null>(null);
const exemplo = computed(() => {
  const f = faixa.value;
  if (!f || !f['numeroInicial']) return '';
  const n = String(f['numeroInicial']);
  const tam = Number(f['tamanhoFixo'] || 0);
  return `${f['prefixo'] ?? ''}${tam ? n.padStart(tam, '0') : n}`;
});
const motivo = ref('');
const TIPOS_GUIA = [
  'consulta',
  'sp_sadt',
  'internacao',
  'honorario',
  'odontologia',
  'outras_despesas',
  'anexo',
];
</script>

<template>
  <section class="tela" aria-labelledby="tiss-config-titulo">
    <h1 id="tiss-config-titulo">{{ t('estruturaGestao.tiss.titulo') }}</h1>
    <p>{{ t('estruturaGestao.tiss.texto') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="ok" role="status" data-testid="gravado">{{ t('estruturaGestao.comum.gravado') }}</p>
    <label>
      {{ t('estruturaGestao.tiss.fonte') }}
      <select v-model="fonte" name="fonte" data-testid="fonte">
        <option :value="null">{{ t('estruturaGestao.comum.escolha') }}</option>
        <option v-for="f in p?.fontes ?? []" :key="f.id" :value="f.id">{{ f.nome }}</option>
      </select>
    </label>

    <template v-if="fonte && p">
      <h2>{{ t('estruturaGestao.tiss.vigencias') }}</h2>
      <ul data-testid="vigencias">
        <li v-for="v in p.configuracoes" :key="v.id">
          <button type="button" class="link" @click="cfg = { ...v }">
            {{ `${v.vigenciaInicio} → ${v.vigenciaFim ?? '…'}` }}
          </button>
        </li>
      </ul>
      <SanteBotao data-testid="nova-vigencia" @click="novaVigencia">{{
        t('estruturaGestao.tiss.novaVigencia')
      }}</SanteBotao>

      <form
        v-if="cfg"
        class="grade"
        @submit.prevent="
          fazer(() => gravarConfiguracaoTiss(cfg!['id'] as number | null, { ...cfg, fontePagadora: fonte }))
        "
      >
        <label>
          {{ t('estruturaGestao.tiss.vigenciaInicio') }}
          <input
            v-model="cfg['vigenciaInicio'] as string"
            type="date"
            name="vigenciaInicio"
            :disabled="!!cfg['id']"
          />
        </label>
        <label>
          {{ t('estruturaGestao.tiss.vigenciaFim')
          }}<input v-model="cfg['vigenciaFim'] as string" type="date" name="vigenciaFim" />
        </label>
        <label>
          {{ t('estruturaGestao.tiss.versaoPadrao') }}
          <select v-model="cfg['versaoPadrao']" name="versaoPadrao">
            <option v-for="v in p.versoes" :key="v.id" :value="v.id">{{ v.nome }}</option>
          </select>
        </label>
        <label
          v-for="c in [
            'registroAns',
            'codigoPrestadorOperadora',
            'cnpjContratado',
            'razaoSocialContratado',
            'limiteGuiasLote',
            'diasRetornoConsulta',
          ] as const"
          :key="c"
        >
          {{ t(`estruturaGestao.tiss.${c}`) }}
          <input v-model="cfg[c] as string" :name="c" :aria-invalid="avisos.includes(c)" />
        </label>
        <label
          v-for="[c, ops] in [
            ['identificacaoPrestador', ['cnpj', 'cpf', 'codigo_operadora']],
            ['numeracaoGuia', ['prestador', 'operadora', 'sequencial_unico']],
            ['ordenacaoGuias', ['numero', 'data', 'paciente', 'atendimento']],
            ['quebraResumoInternacao', ['nao_quebra', 'por_competencia', 'por_periodo', 'por_conta_parcial']],
          ] as const"
          :key="c"
        >
          {{ t(`estruturaGestao.tiss.${c}`) }}
          <select v-model="cfg[c]" :name="c">
            <option v-for="o in ops" :key="o" :value="o">{{ t(`estruturaGestao.tiss.opcoes.${o}`) }}</option>
          </select>
        </label>
        <fieldset class="largo">
          <legend>{{ t('estruturaGestao.tiss.regras') }}</legend>
          <label v-for="c in SIMS" :key="c" class="marca">
            <input v-model="cfg[c]" type="checkbox" :name="c" :aria-invalid="avisos.includes(c)" />
            {{ t(`estruturaGestao.tiss.sims.${c}`) }}
          </label>
        </fieldset>
        <fieldset class="largo">
          <legend>{{ t('estruturaGestao.tiss.eletronicos') }}</legend>
          <label v-for="c in ELETRONICOS" :key="c" class="marca">
            <input v-model="cfg[c]" type="checkbox" :name="c" :aria-invalid="avisos.includes(c)" />
            {{ t(`estruturaGestao.tiss.sims.${c}`) }}
          </label>
        </fieldset>
        <SanteBotao type="submit" :disabled="avisos.length > 0" data-testid="gravar-configuracao">{{
          t('estruturaGestao.comum.gravar')
        }}</SanteBotao>
      </form>

      <h2>{{ t('estruturaGestao.tiss.faixas') }}</h2>
      <table data-testid="faixas">
        <tbody>
          <tr v-for="f in p.faixas" :key="f.id">
            <td>{{ f.tipoGuia }}</td>
            <td>{{ `${f.prefixo ?? ''}${f.numeroInicial} – ${f.numeroFinal}` }}</td>
            <td>{{ t('estruturaGestao.tiss.consumo', { usados: f.usados, restantes: f.restantes }) }}</td>
            <td>
              {{ t(`estruturaGestao.tiss.situacoes.${f.situacao}`) }}
              <strong v-if="f.noFim" class="aviso"> · {{ t('estruturaGestao.tiss.noFim') }}</strong>
            </td>
            <td v-if="f.situacao !== 'encerrada'">
              <input v-model="motivo" :placeholder="t('estruturaGestao.comum.motivo')" />
              <button
                type="button"
                :disabled="motivo.trim().length < 10"
                @click="
                  fazer(
                    () => encerrarFaixa(f.id, { versao: f.versao, motivo }),
                    () => (motivo = ''),
                  )
                "
              >
                {{ t('estruturaGestao.tiss.encerrar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        data-testid="nova-faixa"
        @click="
          faixa = {
            tipoGuia: 'sp_sadt',
            formaGeracao: 'faixa_operadora',
            vigenciaInicio: new Date().toISOString().slice(0, 10),
          }
        "
      >
        {{ t('estruturaGestao.tiss.novaFaixa') }}
      </SanteBotao>
      <form
        v-if="faixa"
        class="grade"
        @submit.prevent="
          fazer(
            () => incluirFaixa({ ...faixa, fontePagadora: fonte }),
            () => (faixa = null),
          )
        "
      >
        <label>
          {{ t('estruturaGestao.tiss.tipoGuia') }}
          <select v-model="faixa['tipoGuia']" name="tipoGuia">
            <option v-for="x in TIPOS_GUIA" :key="x" :value="x">{{ x }}</option>
          </select>
        </label>
        <label>
          {{ t('estruturaGestao.tiss.formaGeracao') }}
          <select v-model="faixa['formaGeracao']" name="formaGeracao">
            <option value="faixa_operadora">{{ t('estruturaGestao.tiss.faixaOperadora') }}</option>
            <option value="sequencial_hospital">{{ t('estruturaGestao.tiss.sequencialHospital') }}</option>
          </select>
        </label>
        <label v-for="c in ['prefixo', 'tamanhoFixo', 'numeroInicial', 'numeroFinal'] as const" :key="c">
          {{ t(`estruturaGestao.tiss.${c}`) }}<input v-model="faixa[c] as string" :name="c" />
        </label>
        <label
          >{{ t('estruturaGestao.tiss.vigenciaInicio')
          }}<input v-model="faixa['vigenciaInicio'] as string" type="date"
        /></label>
        <p v-if="exemplo" data-testid="exemplo-numero">
          {{ t('estruturaGestao.tiss.exemplo', { n: exemplo }) }}
        </p>
        <SanteBotao type="submit" data-testid="gravar-faixa">{{
          t('estruturaGestao.comum.gravar')
        }}</SanteBotao>
      </form>
    </template>
  </section>
</template>

<style scoped>
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2) var(--sgh-espaco-3);
  margin-top: var(--sgh-espaco-3);
}
.grade label {
  display: flex;
  flex-direction: column;
}
.grade .marca {
  flex-direction: row;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.largo {
  grid-column: 1 / -1;
}
.aviso {
  color: var(--sgh-cor-erro, #b00020);
}
.link {
  background: none;
  border: 0;
  text-decoration: underline;
  cursor: pointer;
}
</style>
