<script setup lang="ts">
// Migração gradual: fim da coexistência por hospital (M43; ficha, campo 7, regras 1, 2, 3, 7 e 8). No estabelecimento
// ativo, cada item do critério de acompanhamento (cap-15 §15.3.5; DP-5) com o valor, as parcelas impressas, a fonte, a
// situação e a data em que ficou verde; o conjunto do cap-14 §14.9.4 ao lado, para a decisão do dono (regra 2), com a
// divergência; o que falta para registrar o fim; as gravações ainda não liberadas (em agregados) e as que ficam no
// outro sistema por decisão; e o registro do fim (ensaios da contingência, ata, aceite, decisão de desligamento).
// Registrar o fim é do dono: pelo registro gravado nesta tela (motivo e senha) ou, na exceção do parâmetro
// coexistencia.registro.modo, só pelo registro versionado (D-RETRO-REGISTRO-F6, W0-09); não desliga nada (regra 8).
import type { ItemPainelFim, TelaFimCoexistencia } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerFim } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import RegistroCoexEditor from '../componentes/RegistroCoexEditor.vue';

const { t, te } = useI18n();
const consulta = useQuery({ queryKey: ['coexistencia', 'fim'], queryFn: lerFim });
const tela = computed<TelaFimCoexistencia | undefined>(() => consulta.data.value);
const podeRever = computed(() => pode('acesso.usuario.ler'));
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const rotuloParcela = (r: string) =>
  te(`coexistencia.fim.parcelasRotulos.${r}`) ? t(`coexistencia.fim.parcelasRotulos.${r}`) : r;
const parcelas = (i: ItemPainelFim) =>
  i.parcelas.map((p) => `${rotuloParcela(p.rotulo)}: ${p.valor}`).join(' · ');
const estado = (e: string) =>
  te(`coexistencia.fim.operacoes.estados.${e}`) ? t(`coexistencia.fim.operacoes.estados.${e}`) : e;
// O que falta e a divergência montados com os rótulos da tela (o servidor guarda o código do item, para o registro).
const rotuloItem = (i: string) => t(`coexistencia.fim.itens.${i}`);
const pendencias = computed(() => {
  const p = tela.value?.painel;
  if (!p) return [];
  return [
    ...p.cap15.filter((i) => i.situacao !== 'verde'),
    ...p.cap14.filter((i) => i.item === 'contingencia-pronta' && i.situacao !== 'verde'),
  ].map((i) => `${rotuloItem(i.item)}: ${i.motivo ?? t(`coexistencia.fim.situacoes.${i.situacao}`)}`);
});
const divergencias = computed(() => {
  const p = tela.value?.painel;
  if (!p || p.divergencias.length === 0) return [];
  return p.cap14.filter((i) => i.situacao !== 'verde').map((i) => rotuloItem(i.item));
});
const conjuntos = computed(() =>
  tela.value
    ? [
        { id: 'cap15', titulo: t('coexistencia.fim.criterio'), itens: tela.value.painel.cap15 },
        { id: 'cap14', titulo: t('coexistencia.fim.conjuntoAoLado'), itens: tela.value.painel.cap14 },
      ]
    : [],
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-fim" data-testid="tela-migracao-fim">
    <h1 id="titulo-fim">{{ t('coexistencia.fim.titulo') }}</h1>
    <AbasMigracao atual="fim" />
    <p>{{ t('coexistencia.fim.explicacao') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!tela" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="fim-medido-em">
        <strong>{{ t('coexistencia.fim.medidoEm') }}:</strong> {{ tela.painel.medidoEm }}
      </p>
      <SanteAlerta
        v-if="tela.registroInvalido"
        :texto="t('coexistencia.fim.registro.invalido', { motivo: tela.registroInvalido })"
        variante="aviso"
        data-testid="fim-registro-invalido"
      />
      <SanteAlerta
        v-if="tela.painel.fimRegistradoEm"
        :texto="t('coexistencia.fim.fimRegistrado', { data: dia(tela.painel.fimRegistradoEm) })"
        variante="info"
        data-testid="fim-registrado"
      />
      <p data-testid="fim-veredito">
        <strong>{{
          tela.painel.fimRegistravel
            ? t('coexistencia.fim.fimRegistravel')
            : t('coexistencia.fim.fimNaoRegistravel')
        }}</strong>
      </p>

      <section
        v-for="c in conjuntos"
        :key="c.id"
        :aria-labelledby="`fim-${c.id}`"
        :data-testid="`fim-${c.id}`"
      >
        <h2 :id="`fim-${c.id}`">{{ c.titulo }}</h2>
        <div class="rolagem">
          <table class="tabela">
            <caption>
              {{
                c.titulo
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.fim.item') }}</th>
                <th scope="col">{{ t('coexistencia.fim.valor') }}</th>
                <th scope="col">{{ t('coexistencia.fim.parcelas') }}</th>
                <th scope="col">{{ t('coexistencia.fim.fonte') }}</th>
                <th scope="col">{{ t('coexistencia.fim.situacao') }}</th>
                <th scope="col">{{ t('coexistencia.fim.verdeDesde') }}</th>
                <th scope="col">{{ t('coexistencia.fim.motivo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in c.itens" :key="i.item" :data-testid="`fim-item-${i.item}`">
                <th scope="row">{{ t(`coexistencia.fim.itens.${i.item}`) }}</th>
                <td data-testid="valor">{{ i.valor ?? t('coexistencia.fim.semValor') }}</td>
                <td data-testid="parcelas">{{ parcelas(i) || t('coexistencia.fim.semValor') }}</td>
                <td>{{ t(`coexistencia.fim.fontes.${i.item}`) }}</td>
                <td data-testid="situacao">
                  <span :class="`situacao-${i.situacao}`">{{
                    t(`coexistencia.fim.situacoes.${i.situacao}`)
                  }}</span>
                </td>
                <td data-testid="verde-desde">{{ dia(i.verdeDesde) }}</td>
                <td data-testid="motivo">{{ i.motivo ?? '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="fim-divergencias" data-testid="fim-divergencias">
        <h2 id="fim-divergencias">{{ t('coexistencia.fim.divergencia') }}</h2>
        <template v-if="divergencias.length">
          <p>{{ t('coexistencia.fim.divergenciaTexto') }}</p>
          <ul>
            <li v-for="d in divergencias" :key="d">{{ d }}</li>
          </ul>
        </template>
        <p v-else>{{ t('coexistencia.fim.semPendencias') }}</p>
      </section>

      <section aria-labelledby="fim-pendencias" data-testid="fim-pendencias">
        <h2 id="fim-pendencias">{{ t('coexistencia.fim.pendencias') }}</h2>
        <ul v-if="pendencias.length">
          <li v-for="p in pendencias" :key="p">{{ p }}</li>
        </ul>
        <p v-else>{{ t('coexistencia.fim.semPendencias') }}</p>
      </section>

      <section aria-labelledby="fim-por-papel" data-testid="fim-por-papel">
        <h2 id="fim-por-papel">{{ t('coexistencia.fim.porPapel.titulo') }}</h2>
        <p>{{ t('coexistencia.fim.porPapel.texto') }}</p>
        <p v-if="tela.usuariosPorPapel.length === 0">{{ t('coexistencia.fim.porPapel.nenhum') }}</p>
        <table v-else class="tabela">
          <caption>
            {{
              t('coexistencia.fim.porPapel.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.fim.porPapel.papel') }}</th>
              <th scope="col">{{ t('coexistencia.fim.porPapel.ativos') }}</th>
              <th scope="col">{{ t('coexistencia.fim.porPapel.semTrilha') }}</th>
              <th scope="col">{{ t('coexistencia.fim.porPapel.semAcesso') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in tela.usuariosPorPapel" :key="x.papel" :data-testid="`por-papel-${x.papel}`">
              <th scope="row">{{ t(`coexistencia.papeis.${x.papel}`) }}</th>
              <td>{{ x.ativos }}</td>
              <td>{{ x.semTrilha }}</td>
              <td>{{ x.semAcesso }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="fim-operacoes" data-testid="fim-operacoes">
        <h2 id="fim-operacoes">{{ t('coexistencia.fim.operacoes.titulo') }}</h2>
        <p v-if="tela.foraPorEstado.length === 0">{{ t('coexistencia.fim.operacoes.nenhuma') }}</p>
        <div v-else class="lado-a-lado">
          <table class="tabela" data-testid="fim-por-estado">
            <caption>
              {{
                t('coexistencia.fim.operacoes.porEstado')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.fim.operacoes.estado') }}</th>
                <th scope="col">{{ t('coexistencia.fim.operacoes.quantas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in tela.foraPorEstado" :key="x.estado">
                <th scope="row">{{ estado(x.estado) }}</th>
                <td>{{ x.n }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela" data-testid="fim-por-modulo">
            <caption>
              {{
                t('coexistencia.fim.operacoes.porModulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.fim.operacoes.modulo') }}</th>
                <th scope="col">{{ t('coexistencia.fim.operacoes.quantas') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in tela.foraPorModulo" :key="x.modulo">
                <th scope="row">{{ x.modulo }}</th>
                <td>{{ x.n }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="tela.excecoes.length">
          <h3>{{ t('coexistencia.fim.operacoes.excecoes') }}</h3>
          <ul data-testid="fim-excecoes">
            <li v-for="x in tela.excecoes" :key="x.operacao">
              {{ x.decisao }} ({{ t('coexistencia.fim.operacoes.decididaEm') }} {{ dia(x.decididaEm) }})
            </li>
          </ul>
        </template>
      </section>

      <section aria-labelledby="fim-atrasados" data-testid="fim-atrasados">
        <h2 id="fim-atrasados">{{ t('coexistencia.fim.atrasados.titulo') }}</h2>
        <p v-if="tela.setoresAtrasados.length === 0">{{ t('coexistencia.fim.atrasados.nenhum') }}</p>
        <template v-else>
          <p>{{ t('coexistencia.fim.atrasados.texto') }}</p>
          <table class="tabela">
            <caption>
              {{
                t('coexistencia.fim.atrasados.titulo')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.fim.atrasados.setor') }}</th>
                <th scope="col">{{ t('coexistencia.fim.atrasados.onda') }}</th>
                <th scope="col">{{ t('coexistencia.fim.atrasados.meta') }}</th>
                <th scope="col">{{ t('coexistencia.fim.atrasados.novaData') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in tela.setoresAtrasados" :key="x.codigo">
                <th scope="row">{{ x.nome }}</th>
                <td>{{ x.onda }}</td>
                <td>{{ dia(x.meta) }}</td>
                <td>{{ dia(x.novaData) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <section aria-labelledby="fim-registro" data-testid="fim-registro">
        <h2 id="fim-registro">{{ t('coexistencia.fim.registro.titulo') }}</h2>
        <p>{{ t('coexistencia.fim.registro.caminho', { caminho: tela.registro }) }}</p>
        <table class="tabela" data-testid="fim-ensaios">
          <caption>
            {{
              t('coexistencia.fim.registro.ensaiosTitulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.fim.registro.ensaio') }}</th>
              <th scope="col">{{ t('coexistencia.fim.registro.data') }}</th>
              <th scope="col">{{ t('coexistencia.fim.registro.resultado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in tela.ensaios" :key="e.tipo" :data-testid="`ensaio-${e.tipo}`">
              <th scope="row">{{ t(`coexistencia.fim.ensaios.${e.tipo}`) }}</th>
              <td>{{ dia(e.data) }}</td>
              <td>
                {{
                  e.resultado
                    ? t(`coexistencia.fim.registro.resultados.${e.resultado}`)
                    : t('coexistencia.fim.registro.semRegistro')
                }}
              </td>
            </tr>
          </tbody>
        </table>
        <ul>
          <li>{{ t('coexistencia.fim.registro.contas', { n: tela.contasCombinadas }) }}</li>
          <li data-testid="fim-ata">
            {{
              tela.ata
                ? t('coexistencia.fim.registro.ata', {
                    data: dia(tela.ata.data),
                    referencia: tela.ata.referencia,
                  })
                : t('coexistencia.fim.registro.semAta')
            }}
          </li>
          <li>
            {{
              tela.aceiteDiretoria
                ? t('coexistencia.fim.registro.aceite', { data: dia(tela.aceiteDiretoria) })
                : t('coexistencia.fim.registro.semAceite')
            }}
          </li>
          <li data-testid="fim-dp6">
            <template v-if="tela.dp6.decididaEm">{{
              t('coexistencia.fim.registro.dp6Decidida', {
                decisao: tela.dp6.decisao,
                data: dia(tela.dp6.decididaEm),
              })
            }}</template>
            <template v-else-if="tela.dp6.previstaPara">{{
              t('coexistencia.fim.registro.dp6Prevista', { data: dia(tela.dp6.previstaPara) })
            }}</template>
            <template v-else>{{ t('coexistencia.fim.registro.dp6Pendente') }}</template>
          </li>
        </ul>
      </section>

      <p v-if="podeRever">
        <RouterLink to="/administracao/acesso/usuarios/revisao" data-testid="ir-revisao">{{
          t('coexistencia.fim.irRevisao')
        }}</RouterLink>
      </p>
    </template>
    <RegistroCoexEditor tipo="fim" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.lado-a-lado {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: flex-start;
}
.rolagem {
  overflow-x: auto;
}
.situacao-verde {
  font-weight: 700;
}
</style>
