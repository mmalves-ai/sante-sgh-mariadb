<script setup lang="ts">
// Registro do prontuário (M15; ficha, seção 7), em abas: como emitido (o documento emitido com o cabeçalho
// congelado; sem ele, o formulário da época com o contexto do ato), layout da época (o formulário que o próprio
// registro carrega), texto formatado, respostas estruturadas e contexto do ato (retratos do momento). Cada aba
// aberta vai ao registro de acesso. Só visualização: nada aqui grava.
import { ABAS_REGISTRO, type AbaRegistro } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { abrirRegistro, lerAba } from '../api-pep.js';
import CabecalhoProntuario from '../componentes/CabecalhoProntuario.vue';
import CamposFormulario from '../componentes/CamposFormulario.vue';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import ItensRespostas from '../componentes/ItensRespostas.vue';
import MarcasRegistro from '../componentes/MarcasRegistro.vue';
import TextoFormatado from '../componentes/TextoFormatado.vue';
import { dataHoraBr } from '../formato.js';
import { useMotivo } from '../motivo.js';

const props = defineProps<{ paciente: string; registro: string }>();
const { t } = useI18n();
const roteador = useRouter();
const idPaciente = computed(() => Number(props.paciente));
const idRegistro = computed(() => Number(props.registro));
const m = useMotivo(idPaciente);
watch(() => m.consulta.data.value, m.aoCarregar, { immediate: true });

const aberto = useQuery({
  queryKey: computed(() => ['pep', 'registro', idPaciente.value, idRegistro.value]),
  queryFn: () => abrirRegistro(idPaciente.value, idRegistro.value),
  enabled: computed(() => m.pronto.value),
  staleTime: 0,
});
const r = computed(() => aberto.data.value);
const aba = ref<AbaRegistro>('como-emitido');
watch(idRegistro, () => (aba.value = 'como-emitido'));
const conteudo = useQuery({
  queryKey: computed(() => ['pep', 'aba', idPaciente.value, idRegistro.value, aba.value]),
  queryFn: () => lerAba(idPaciente.value, idRegistro.value, aba.value),
  enabled: computed(() => m.pronto.value && Boolean(r.value?.abas[aba.value]?.disponivel)),
  staleTime: 0,
});
const c = computed(() => conteudo.data.value);

const botoes = ref<HTMLButtonElement[]>([]);
function teclar(e: KeyboardEvent, i: number): void {
  const n = ABAS_REGISTRO.length;
  const destino =
    e.key === 'ArrowRight'
      ? (i + 1) % n
      : e.key === 'ArrowLeft'
        ? (i - 1 + n) % n
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? n - 1
            : -1;
  if (destino < 0) return;
  e.preventDefault();
  aba.value = ABAS_REGISTRO[destino]!;
  void nextTick(() => botoes.value[destino]?.focus());
}
function cancelado(): void {
  if (!m.pronto.value) void roteador.push('/pep/prontuario');
}
</script>

<template>
  <section class="tela" aria-labelledby="pep-registro-titulo" data-testid="tela-registro">
    <h1 id="pep-registro-titulo">{{ t('pep.registro.titulo') }}</h1>
    <DialogoMotivo
      v-model:visivel="m.pedir.value"
      :paciente="idPaciente"
      :restricao-atendimento="m.restricao.value"
      @informado="m.informado"
      @cancelado="cancelado"
    />
    <MensagemErro v-if="m.consulta.isError.value" :erro="m.consulta.error.value" />
    <p v-else-if="!m.pronto.value" role="status">{{ t('pep.motivo.aguardando') }}</p>
    <MensagemErro v-else-if="aberto.isError.value" :erro="aberto.error.value" />
    <p v-else-if="!r" role="status">{{ t('pep.carregando') }}</p>
    <template v-else>
      <p>
        <RouterLink :to="`/pep/prontuario/${idPaciente}`">{{ t('pep.registro.voltar') }}</RouterLink>
      </p>
      <CabecalhoProntuario :cabecalho="r.cabecalho" />
      <dl class="resumo" data-testid="resumo-registro">
        <div>
          <dt>{{ t('pep.registros.data') }}</dt>
          <dd>{{ dataHoraBr(r.registro.dataHora) || t('pep.marcas.semData') }}</dd>
        </div>
        <div>
          <dt>{{ t('pep.registro.lancado') }}</dt>
          <dd>{{ dataHoraBr(r.registro.lancadoEm) }}</dd>
        </div>
        <div>
          <dt>{{ t('pep.registros.modelo') }}</dt>
          <dd>{{ [r.registro.modelo.codigo, r.registro.modelo.nome].filter(Boolean).join(' · ') }}</dd>
        </div>
        <div>
          <dt>{{ t('pep.registros.profissional') }}</dt>
          <dd>
            {{ r.registro.profissional.nome ?? '' }} ({{
              t(`pep.categorias.${r.registro.profissional.categoria}`)
            }})
          </dd>
        </div>
      </dl>
      <MarcasRegistro :marcas="r.registro.marcas" :paciente="idPaciente" detalhe />
      <div class="abas" role="tablist" :aria-label="t('pep.registro.abas')">
        <button
          v-for="(a, i) in ABAS_REGISTRO"
          :id="`aba-${a}`"
          :key="a"
          ref="botoes"
          type="button"
          role="tab"
          :aria-selected="aba === a"
          :aria-controls="`painel-${a}`"
          :tabindex="aba === a ? 0 : -1"
          :data-testid="`aba-${a}`"
          @click="aba = a"
          @keydown="teclar($event, i)"
        >
          {{ t(`pep.abas.${a}`) }}
        </button>
      </div>
      <div
        :id="`painel-${aba}`"
        class="painel"
        role="tabpanel"
        :aria-labelledby="`aba-${aba}`"
        tabindex="0"
        data-testid="painel-aba"
      >
        <SanteAlerta
          v-if="!r.abas[aba]?.disponivel"
          variante="info"
          :texto="r.abas[aba]?.motivo ?? t('pep.registro.indisponivel')"
        />
        <MensagemErro v-else-if="conteudo.isError.value" :erro="conteudo.error.value" />
        <p v-else-if="!c" role="status">{{ t('pep.carregando') }}</p>
        <template v-else-if="c.aba === 'como-emitido'">
          <SanteAlerta
            v-if="c.conteudo.aviso"
            variante="info"
            :texto="c.conteudo.aviso"
            data-testid="aviso-fonte"
          />
          <section v-for="b in c.conteudo.blocos" :key="b.titulo" class="bloco">
            <h3>{{ b.titulo }}</h3>
            <dl>
              <div v-for="x in b.campos" :key="x.rotulo">
                <dt>{{ x.rotulo }}</dt>
                <dd>{{ x.valor }}</dd>
              </div>
            </dl>
          </section>
          <CamposFormulario
            v-if="c.conteudo.campos.length > 0"
            :campos="c.conteudo.campos"
            :rotulo="t('pep.abas.como-emitido')"
          />
          <TextoFormatado v-if="c.conteudo.texto" :texto="c.conteudo.texto" />
          <section v-if="c.conteudo.eventos.length > 0" class="bloco" data-testid="eventos-documento">
            <h3>{{ t('pep.registro.eventos') }}</h3>
            <ul>
              <li v-for="(e, i) in c.conteudo.eventos" :key="i">
                {{ e.situacao }} · {{ dataHoraBr(e.em)
                }}<template v-if="e.profissional"> · {{ e.profissional }}</template>
              </li>
            </ul>
          </section>
        </template>
        <template v-else-if="c.aba === 'layout'">
          <p v-if="c.conteudo.composicao" class="composicao">{{ c.conteudo.composicao }}</p>
          <CamposFormulario :campos="c.conteudo.campos" :rotulo="t('pep.abas.layout')" />
        </template>
        <template v-else-if="c.aba === 'texto'">
          <SanteAlerta
            v-if="c.conteudo.aviso"
            variante="aviso"
            :texto="c.conteudo.aviso"
            data-testid="aviso-texto"
          />
          <p v-else-if="c.conteudo.paragrafos.length === 0">{{ t('pep.registro.textoVazio') }}</p>
          <TextoFormatado v-else :texto="c.conteudo" />
          <p v-if="c.conteudo.conteudoAtivoRemovido > 0" class="nota">
            {{ t('pep.registro.ativoRemovido', { n: c.conteudo.conteudoAtivoRemovido }) }}
          </p>
        </template>
        <template v-else-if="c.aba === 'respostas'">
          <p v-if="c.conteudo.itens.length === 0">{{ t('pep.respostas.vazio') }}</p>
          <ItensRespostas v-else :itens="c.conteudo.itens" />
          <p class="nota">
            {{ t('pep.respostas.resumo', { total: c.conteudo.total, confirmar: c.conteudo.aConfirmar }) }}
          </p>
        </template>
        <template v-else-if="c.aba === 'contexto'">
          <dl class="contexto" data-testid="contexto-ato">
            <div>
              <dt>{{ t('pep.contexto.paciente') }}</dt>
              <dd>{{ c.conteudo.paciente.nomeSocial ?? c.conteudo.paciente.nome ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.atendimento') }}</dt>
              <dd>{{ c.conteudo.atendimento.numero ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.entrada') }}</dt>
              <dd>{{ dataHoraBr(c.conteudo.atendimento.entrada) }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.unidade') }}</dt>
              <dd>{{ c.conteudo.atendimento.unidade ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.leito') }}</dt>
              <dd>{{ c.conteudo.atendimento.leito ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.convenio') }}</dt>
              <dd>{{ c.conteudo.atendimento.convenio ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.cid') }}</dt>
              <dd>{{ c.conteudo.atendimento.cidPrincipal ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.assistente') }}</dt>
              <dd>{{ c.conteudo.atendimento.medicoAssistente ?? '' }}</dd>
            </div>
            <div>
              <dt>{{ t('pep.contexto.profissional') }}</dt>
              <dd>
                {{
                  [c.conteudo.profissional.nome, c.conteudo.profissional.conselho].filter(Boolean).join(' · ')
                }}
              </dd>
            </div>
            <div v-if="c.conteudo.responsavel">
              <dt>{{ t('pep.contexto.responsavel') }}</dt>
              <dd>
                {{
                  [c.conteudo.responsavel.nome, c.conteudo.responsavel.parentesco].filter(Boolean).join(' · ')
                }}
              </dd>
            </div>
          </dl>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.resumo,
.bloco dl,
.contexto {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: var(--sgh-espaco-2) 0;
}
dt {
  font-weight: 600;
}
dd {
  margin: 0;
}
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  border-bottom: 1px solid var(--sgh-borda-forte);
  margin-top: var(--sgh-espaco-3);
}
.abas button {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-bottom: none;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  cursor: pointer;
}
.abas button[aria-selected='true'] {
  font-weight: 700;
  border-color: var(--sgh-borda-forte);
  outline: 2px solid var(--sgh-borda-forte);
}
.painel {
  padding: var(--sgh-espaco-2) 0;
}
.bloco h3 {
  margin: var(--sgh-espaco-2) 0 var(--sgh-espaco-1);
  font-size: 1rem;
}
.nota,
.composicao {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
p a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
</style>
