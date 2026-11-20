<script setup lang="ts">
// Qualidade e segurança › CCIH › Isolamento e precauções no mapa de leitos (M48, etapa 3; ficha, seção 7; regra 7): as
// precauções abertas por leito (motivo, tipo, origem, multirresistente, leitos bloqueados), o encerramento com o motivo
// e "Definir precaução" para um internado. A precaução reflete no mapa de leitos (M21), no cabeçalho do paciente e na
// fila da higienização; o leito mostra a mais restritiva das abertas.
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import { MOTIVOS_FIM_PRECAUCAO, PRECAUCOES, rotuloMotivoPrecaucao } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  encerrarPrecaucao,
  lerFormularioCcih,
  lerInternadosCcih,
  lerPrecaucoes,
  novaChaveCcih,
  type PrecaucaoDefinida,
  type PrecaucoesAbertas,
} from '../api-ccih.js';
import ErroCcih from '../componentes/ErroCcih.vue';
import FormularioPrecaucao from '../componentes/FormularioPrecaucao.vue';
import NavCcih from '../componentes/NavCcih.vue';

type Aberta = PrecaucoesAbertas['itens'][number];

const { t } = useI18n();
const cliente = useQueryClient();
const formulario = useQuery({
  queryKey: ['ccih', 'formulario'],
  queryFn: lerFormularioCcih,
  staleTime: 60_000,
});
const podeDefinir = computed(() => formulario.data.value?.acoes.precaucao ?? false);
const lista = useQuery({
  queryKey: ['ccih', 'precaucoes'],
  queryFn: lerPrecaucoes,
  refetchInterval: 120_000,
});
const rotuloTipo = (c: string) => PRECAUCOES.find((p) => p.codigo === c)?.rotulo ?? c;
const leitos = (b: readonly { leito: string; acomodacao: string; bloco: string }[]) =>
  b.map((x) => `${x.bloco} ${x.acomodacao}-${x.leito}`).join(', ');

const aviso = ref<string | null>(null);
const ocupados = ref<string[]>([]);
const erro = ref<unknown>(null);

// ── Definir ──
const internados = useQuery({
  queryKey: ['ccih', 'internados'],
  queryFn: lerInternadosCcih,
  enabled: podeDefinir,
});
const escolhido = ref<number | null>(null);
const definindo = ref(false);
const opInternados = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...(internados.data.value?.itens ?? []).map((i) => ({
    valor: i.internacao as number | null,
    rotulo: `${i.leito} · ${i.nome} (${i.prontuario})`,
  })),
]);
async function definida(r: PrecaucaoDefinida): Promise<void> {
  definindo.value = false;
  escolhido.value = null;
  ocupados.value = r.vizinhosOcupados;
  aviso.value = t('ccih.precaucoes.definida');
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
}

// ── Encerrar ──
const opFim = [
  { valor: '', rotulo: '' },
  ...MOTIVOS_FIM_PRECAUCAO.map((m) => ({ valor: m.codigo as string, rotulo: m.rotulo })),
];
const fim = reactive({ id: 0, motivo: '', observacao: '' });
const chaveFim = ref(novaChaveCcih('encerrar'));
function abrirFim(p: Aberta): void {
  Object.assign(fim, { id: p.id, motivo: '', observacao: '' });
}
async function encerrar(p: Aberta): Promise<void> {
  erro.value = null;
  if (!fim.motivo) return;
  try {
    await encerrarPrecaucao(
      p.id,
      { versao: p.versao, motivo: fim.motivo, observacao: fim.observacao.trim() || null },
      chaveFim.value,
    );
    chaveFim.value = novaChaveCcih('encerrar');
    fim.id = 0;
    ocupados.value = [];
    aviso.value = t('ccih.precaucoes.encerrada');
    await cliente.invalidateQueries({ queryKey: ['ccih'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ccih-prec-titulo" data-testid="tela-ccih-precaucoes">
    <h1 id="ccih-prec-titulo">{{ t('ccih.precaucoes.titulo') }}</h1>
    <NavCcih />
    <p class="secundario">{{ t('ccih.precaucoes.explicacao') }}</p>
    <SanteAlerta
      v-if="formulario.data.value && !formulario.data.value.ligada"
      variante="info"
      :texto="formulario.data.value.motivo ?? t('ccih.desligado')"
    />
    <div v-if="aviso" role="status" data-testid="precaucao-aviso">{{ aviso }}</div>
    <SanteAlerta
      v-if="ocupados.length"
      variante="alerta"
      :texto="t('ccih.precaucoes.vizinhosOcupados', { leitos: ocupados.join(', ') })"
      data-testid="vizinhos-ocupados"
    />
    <ErroCcih v-if="erro" :erro="erro" />

    <section v-if="podeDefinir" class="painel-ccih">
      <div class="linha-ccih">
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('ccih.precaucoes.escolherPaciente')"
          :opcoes="opInternados"
          busca
          data-testid="precaucao-paciente"
        />
        <SanteBotao
          :rotulo="t('ccih.precaucoes.nova')"
          variante="secundario"
          :desabilitado="escolhido === null"
          data-testid="precaucao-nova"
          @acionar="definindo = true"
        />
      </div>
      <FormularioPrecaucao
        v-if="definindo && escolhido !== null"
        :internacao="escolhido"
        @gravado="definida"
        @cancelar="definindo = false"
      />
    </section>

    <ErroCcih v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('ccih.carregando') }}</p>
    <p v-else-if="!lista.data.value.itens.length" data-testid="precaucoes-nenhuma">
      {{ t('ccih.precaucoes.nenhuma') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-precaucoes">
      <caption>
        {{
          t('ccih.precaucoes.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('ccih.precaucoes.colLeito') }}</th>
          <th scope="col">{{ t('ccih.precaucoes.colPaciente') }}</th>
          <th scope="col">{{ t('ccih.precaucoes.colTipo') }}</th>
          <th scope="col">{{ t('ccih.precaucoes.colMotivo') }}</th>
          <th scope="col">{{ t('ccih.precaucoes.colOrigem') }}</th>
          <th scope="col">{{ t('ccih.precaucoes.colDesde') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista.data.value.itens" :key="p.id" :data-testid="`precaucao-${p.id}`">
          <td>
            {{ p.leitoTexto }}
            <div
              v-if="p.situacao !== 'vigente'"
              class="selo selo--grave"
              :data-testid="`precaucao-pendente-${p.id}`"
            >
              {{
                p.situacao === 'transferida'
                  ? t('ccih.precaucoes.situacoes.transferida', { leito: p.leitoAtual ?? '' })
                  : t('ccih.precaucoes.situacoes.internacaoEncerrada')
              }}
            </div>
            <div v-if="p.bloqueios.length" class="secundario">
              {{ t('ccih.precaucoes.bloqueios', { leitos: leitos(p.bloqueios) }) }}
            </div>
          </td>
          <td>
            {{ p.paciente || t('ccih.precaucoes.pacienteSaiu') }}
            <div v-if="p.prontuario !== null" class="secundario">
              {{ t('ccih.prontuario', { n: p.prontuario }) }}
            </div>
          </td>
          <td>
            <strong>{{ rotuloTipo(p.tipo) }}</strong>
          </td>
          <td>
            {{ p.motivoOutro ?? rotuloMotivoPrecaucao(p.motivo as never) }}
            <span v-if="p.multirresistente" class="selo selo--grave">{{
              t('ccih.precaucoes.multirresistente')
            }}</span>
          </td>
          <td>{{ t(`ccih.precaucoes.origens.${p.origem}`) }}</td>
          <td>
            {{ dataHora(p.inicioEm) }}
            <SanteBotao
              v-if="podeDefinir && fim.id !== p.id"
              :rotulo="t('ccih.precaucoes.encerrar')"
              variante="texto"
              :data-testid="`encerrar-${p.id}`"
              @acionar="abrirFim(p)"
            />
            <div v-if="fim.id === p.id" class="linha-ccih" data-testid="form-encerrar">
              <SanteSelecao
                v-model="fim.motivo"
                :rotulo="t('ccih.precaucoes.motivoFim')"
                :opcoes="opFim"
                obrigatorio
                data-testid="encerrar-motivo"
              />
              <SanteCampoTexto v-model="fim.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
              <SanteBotao
                :rotulo="t('ccih.gravar')"
                variante="primario"
                :desabilitado="!fim.motivo"
                data-testid="encerrar-gravar"
                @acionar="encerrar(p)"
              />
              <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="fim.id = 0" />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
