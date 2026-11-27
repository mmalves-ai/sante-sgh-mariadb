<script setup lang="ts">
// Elegibilidade do beneficiário (F3.9, 08-INTG L128 (31)): `/faturamento/elegibilidade?paciente=`. Visão por paciente:
// as coberturas ativas com a última elegibilidade, um clique para consultar (a elegível do dia é reaproveitada pelo
// servidor) e a resposta da operadora registrada na própria linha da consulta pendente, validada na hora pela regra do
// domínio (a negativa exige o motivo; o código de validação só na elegível). O histórico fica inteiro.
// C2-070: com o serviço web da operadora cadastrado, a consulta já sai por ele no mesmo clique; a linha pendente mostra
// "Ler o retorno" (o recibo vira a resposta sozinho) em vez do formulário à mão.
import { conferirRespostaElegibilidade } from '@sgh/dominio-faturamento';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  consultarElegibilidade,
  type ElegibilidadePaciente,
  lerElegibilidade,
  lerRetornoElegibilidade,
  responderElegibilidade,
  URL_TRANSPORTE_ELEGIBILIDADE,
} from '../api-elegibilidade.js';
import EstadoTransporteTiss from '../componentes/EstadoTransporteTiss.vue';

type Situacao = 'elegivel' | 'inelegivel' | 'erro' | 'sem_resposta';
const { t } = useI18n();
const k = (c: string, p: Record<string, unknown> = {}) => t(`elegibilidade.${c}`, p);
const rota = useRoute();
const roteador = useRouter();

const pacienteTexto = ref(String(Number(rota.query['paciente']) || ''));
const paciente = ref<number | null>(null);
const dados = ref<ElegibilidadePaciente | null>(null);
const erro = ref<string | null>(null);
const aviso = ref<string | null>(null);
const resposta = reactive<Record<number, { situacao: Situacao; codigo: string; motivo: string }>>({});
const opSituacoes = (['elegivel', 'inelegivel', 'erro', 'sem_resposta'] as const).map((x) => ({
  valor: x as Situacao,
  rotulo: k(`situacoes.${x}`),
}));
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR');

async function tentar(fn: () => Promise<string | null>): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    aviso.value = await fn();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}
async function recarregar(): Promise<void> {
  if (!paciente.value) return;
  dados.value = await lerElegibilidade(paciente.value);
  for (const c of dados.value.consultas) resposta[c.id] ??= { situacao: 'elegivel', codigo: '', motivo: '' };
}
const abrir = () =>
  tentar(async () => {
    const n = Number(pacienteTexto.value.trim());
    paciente.value = Number.isSafeInteger(n) && n > 0 ? n : null;
    dados.value = null;
    if (paciente.value) await roteador.replace({ query: { paciente: String(paciente.value) } });
    await recarregar();
    return null;
  });

const corpo = (id: number) => {
  const r = resposta[id]!;
  return {
    situacao: r.situacao,
    codigoValidacao: r.situacao === 'elegivel' ? r.codigo.trim() || null : null,
    motivoNegativa: r.situacao === 'elegivel' ? null : r.motivo.trim() || null,
    motivoGlosa: null,
  };
};
const falta = (id: number) => conferirRespostaElegibilidade('pendente', corpo(id)).map((p) => p.mensagem);

const consultar = (cobertura: number) =>
  tentar(async () => {
    const r = await consultarElegibilidade(cobertura);
    await recarregar();
    return r.reaproveitada ? k('reaproveitada') : r.enviada ? k('enviada') : k('registrada');
  });
const lerRetorno = (id: number) =>
  tentar(async () => {
    const r = await lerRetornoElegibilidade(id);
    await recarregar();
    return r.aguardando ? k('aguardando') : k('respondida');
  });
const responder = (id: number, versao: number) =>
  tentar(async () => {
    const b = corpo(id);
    await responderElegibilidade(id, {
      situacao: b.situacao,
      codigoValidacao: b.codigoValidacao,
      motivoNegativa: b.motivoNegativa,
      versao,
    });
    await recarregar();
    return k('respondida');
  });

if (pacienteTexto.value) void abrir();
</script>

<template>
  <section class="elegibilidade" data-testid="elegibilidade" aria-labelledby="eleg-titulo">
    <h1 id="eleg-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <EstadoTransporteTiss :url="URL_TRANSPORTE_ELEGIBILIDADE" />
    <form class="linha" @submit.prevent="abrir">
      <SanteCampoTexto
        v-model="pacienteTexto"
        :rotulo="k('paciente')"
        :max-bytes="12"
        data-testid="eleg-paciente"
      />
      <SanteBotao tipo="submit" variante="secundario" :rotulo="k('abrir')" data-testid="eleg-abrir" />
    </form>
    <p v-if="erro" role="alert" class="erro" data-testid="eleg-erro">{{ erro }}</p>
    <p v-if="aviso" role="status" data-testid="eleg-aviso">{{ aviso }}</p>

    <template v-if="dados">
      <p v-if="!dados.coberturas.length">{{ k('nenhumaCobertura') }}</p>
      <table v-else data-testid="eleg-coberturas">
        <caption>
          {{
            k('coberturas')
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="c in ['fonte', 'carteira', 'validade', 'ultima', 'acoes']" :key="c" scope="col">
              {{ k(`colunas.${c}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.coberturas" :key="c.id" :data-testid="`eleg-cobertura-${c.id}`">
            <td>{{ c.fontePagadora }}</td>
            <td>{{ c.carteira }}</td>
            <td>{{ c.validade ? new Date(c.validade).toLocaleDateString('pt-BR') : '' }}</td>
            <td data-testid="eleg-ultima">
              {{
                c.ultimaElegibilidadeEm
                  ? k(c.ultimaAprovada ? 'ultimaAprovada' : 'ultimaNegada', {
                      quando: quando(c.ultimaElegibilidadeEm),
                    })
                  : k('nunca')
              }}
            </td>
            <td>
              <SanteBotao :rotulo="k('consultar')" data-testid="eleg-consultar" @acionar="consultar(c.id)" />
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{{ k('historico') }}</h2>
      <p v-if="!dados.consultas.length">{{ k('nenhumaConsulta') }}</p>
      <table v-else data-testid="eleg-consultas">
        <thead>
          <tr>
            <th v-for="c in ['quando', 'fonte', 'situacao', 'resposta']" :key="c" scope="col">
              {{ k(`colunas.${c}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in dados.consultas" :key="c.id" :data-testid="`eleg-consulta-${c.id}`">
            <td>{{ quando(c.solicitadaEm) }}</td>
            <td>{{ c.fontePagadora }} · {{ c.carteira }}</td>
            <td data-testid="eleg-situacao">{{ k(`situacoes.${c.situacao}`) }}</td>
            <td v-if="c.situacao !== 'pendente'">{{ c.codigoValidacao ?? c.motivoNegativa ?? '' }}</td>
            <td v-else-if="resposta[c.id]" class="linha">
              <template v-if="c.pelaOperadora">
                <span data-testid="eleg-pela-operadora">{{ k('pelaOperadora') }}</span>
                <SanteBotao
                  variante="secundario"
                  :rotulo="k('lerRetorno')"
                  data-testid="eleg-ler-retorno"
                  @acionar="lerRetorno(c.id)"
                />
                <span data-testid="eleg-sem-retorno">{{ k('semRetornoAMao') }}</span>
              </template>
              <SanteSelecao
                v-model="resposta[c.id]!.situacao"
                :rotulo="k('respostaDa')"
                :opcoes="opSituacoes"
                data-testid="eleg-resposta"
              />
              <SanteCampoTexto
                v-if="resposta[c.id]!.situacao === 'elegivel'"
                v-model="resposta[c.id]!.codigo"
                :rotulo="k('codigoValidacao')"
                :max-bytes="20"
                data-testid="eleg-codigo"
              />
              <SanteCampoTexto
                v-else
                v-model="resposta[c.id]!.motivo"
                :rotulo="k('motivoNegativa')"
                :max-bytes="2000"
                data-testid="eleg-motivo"
              />
              <SanteBotao
                :rotulo="k('registrar')"
                :desabilitado="falta(c.id).length > 0"
                data-testid="eleg-registrar"
                @acionar="responder(c.id, c.versao)"
              />
              <ul v-if="falta(c.id).length" class="erro" data-testid="eleg-falta">
                <li v-for="m in falta(c.id)" :key="m">{{ m }}</li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.elegibilidade {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.erro {
  color: var(--sgh-alerta);
}
</style>
